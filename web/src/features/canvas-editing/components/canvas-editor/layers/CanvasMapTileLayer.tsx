import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useMapLayerStore, type MapLayer } from "@/model/mapLayerStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { convertLinearToBase } from "@/utils/unitOfMeasure";
import {
    MAX_TILE_ZOOM,
    TILE_SIZE,
    lonToMercX,
    latToMercY,
    getTileZoomState,
    mercXToTileX,
    mercYToTileY,
    tileXToMercX,
    tileYToMercY,
    canvasToMerc,
    mercToCanvas,
} from "@/utils/geoProjection";
import type { GeoAnchorMerc } from "@/utils/geoProjection";

/** How many extra tile rows/columns to load beyond the visible edge. */
const TILE_BUFFER = 1;
/** Small overlap (in screen px) to hide anti-aliased seams between tiles. */
const TILE_OVERLAP_PX = 1;
/** Images kept in memory; the least recently drawn go first. */
const MAX_CACHED_TILES = 600;
/** How many zoom levels up a missing tile looks for a loaded stand-in. */
const MAX_FALLBACK_LEVELS = 4;

/**
 * Both layers are ArcGIS tiles: no API key; Esri's terms want the attribution
 * (TILE_ATTRIBUTION) shown on the canvas. OpenStreetMap's own tile servers were
 * not chosen: their usage policy rules out an app that loads tiles in bulk.
 * Note: ArcGIS uses z/y/x order (row before column), unlike the standard z/x/y.
 */
/** The layers that have tiles; Empty draws and requests nothing. */
type TileLayer = Exclude<MapLayer, "empty">;

const TILE_SERVICE: Record<TileLayer, string> = {
    satellite: "World_Imagery",
    street: "World_Street_Map",
};

export const TILE_ATTRIBUTION: Record<TileLayer, string> = {
    satellite: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    street: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community",
};

export function tileUrl(layer: TileLayer, z: number, x: number, y: number): string {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/${TILE_SERVICE[layer]}/MapServer/tile/${z}/${y}/${x}`;
}

interface TileEntry {
    layer: TileLayer;
    z: number;
    x: number;
    y: number;
    url: string;
    /** Left edge in screen pixels. */
    screenX: number;
    /** Top edge in screen pixels. */
    screenY: number;
    /** Tile side length in screen pixels. */
    screenSize: number;
}

function CanvasMapTileLayerInner() {
    const geoAnchor = useGeoAnchorStore((s) => s.mapGeoAnchor);
    const unitOfMeasure = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);
    const layer = useMapLayerStore((s) => s.layer);

    const position = useCanvasViewStore((s) => s.position);
    const scale = useCanvasViewStore((s) => s.scale);
    const canvasSize = useCanvasViewStore((s) => s.canvasSize);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
    const [imageVersion, setImageVersion] = useState(0);

    const tiles = useMemo<TileEntry[]>(() => {
        if (!geoAnchor || layer === "empty") return [];

        const { width, height } = canvasSize;
        if (width <= 0 || height <= 0) return [];

        if (unitOfMeasure === "none") return [];

        const effectiveMpu = convertLinearToBase(1, unitOfMeasure);

        const anchorMerc: GeoAnchorMerc = {
            anchorMx: lonToMercX(geoAnchor.lon),
            anchorMy: latToMercY(geoAnchor.lat),
            anchorLat: geoAnchor.lat,
            metersPerUnit: effectiveMpu,
        };

        const { zoom, overscale } = getTileZoomState(scale, effectiveMpu, geoAnchor.lat);

        // Viewport bounds in canvas world coordinates
        const worldMinX = -position.x / scale;
        const worldMaxX = (width - position.x) / scale;
        const worldMinY = -position.y / scale;
        const worldMaxY = (height - position.y) / scale;

        // Canvas world corners → Web Mercator (applies Mercator scale factor internally)
        const { mx: mxMin, my: myMax } = canvasToMerc(worldMinX, worldMinY, anchorMerc);
        const { mx: mxMax, my: myMin } = canvasToMerc(worldMaxX, worldMaxY, anchorMerc);

        // Tile range
        const tileXMin = Math.floor(mercXToTileX(mxMin, zoom)) - TILE_BUFFER;
        const tileXMax = Math.floor(mercXToTileX(mxMax, zoom)) + TILE_BUFFER;
        const tileYMin = Math.floor(mercYToTileY(myMax, zoom)) - TILE_BUFFER;
        const tileYMax = Math.floor(mercYToTileY(myMin, zoom)) + TILE_BUFFER;

        const maxTileIndex = Math.pow(2, zoom) - 1;

        // Screen size of one source tile (256px) at current view scale.
        // When zoom is clamped to MAX_TILE_ZOOM, overscale grows past 1.
        const tilePx = TILE_SIZE * overscale;

        // Use a single reference tile origin, then place neighbors via index
        // offsets. This avoids tiny per-tile float divergences that can show up
        // as periodic seams at high zoom.
        const refTx = tileXMin;
        const refTy = tileYMin;
        const refMx = tileXToMercX(refTx, zoom);
        const refMy = tileYToMercY(refTy, zoom);
        const { cx: refCx, cy: refCy } = mercToCanvas(refMx, refMy, anchorMerc);
        const refScreenX = refCx * scale + position.x;
        const refScreenY = refCy * scale + position.y;

        const result: TileEntry[] = [];

        for (let ty = tileYMin; ty <= tileYMax; ty++) {
            if (ty < 0 || ty > maxTileIndex) continue;
            for (let tx = tileXMin; tx <= tileXMax; tx++) {
                if (tx < 0 || tx > maxTileIndex) continue;

                const screenX = refScreenX + (tx - refTx) * tilePx;
                const screenY = refScreenY + (ty - refTy) * tilePx;

                result.push({
                    layer,
                    z: zoom,
                    x: tx,
                    y: ty,
                    url: tileUrl(layer, zoom, tx, ty),
                    screenX,
                    screenY,
                    screenSize: tilePx,
                });
            }
        }

        return result;
    }, [geoAnchor, position, scale, canvasSize, unitOfMeasure, layer]);

    useEffect(() => {
        if (tiles.length === 0) return;

        let cancelled = false;
        const cache = imageCacheRef.current;
        const wanted = new Set(tiles.map((t) => t.url));

        // A fast zoom or pan leaves loads nobody needs any more: stop them.
        for (const [url, img] of cache) {
            if (!wanted.has(url) && !img.complete) {
                img.src = "";
                cache.delete(url);
            }
        }

        for (const tile of tiles) {
            if (cache.has(tile.url)) continue;

            const img = new Image();
            img.decoding = "async";
            img.crossOrigin = "anonymous";
            img.onload = () => {
                if (!cancelled) setImageVersion((v) => v + 1);
            };
            img.onerror = () => {
                if (!cancelled) setImageVersion((v) => v + 1);
            };
            img.src = tile.url;
            cache.set(tile.url, img);
        }

        // Bound the cache: a Map iterates oldest first, and drawn tiles are re-inserted.
        for (const url of cache.keys()) {
            if (cache.size <= MAX_CACHED_TILES) break;
            if (!wanted.has(url)) cache.delete(url);
        }

        return () => {
            cancelled = true;
        };
    }, [tiles]);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const { width, height } = canvasSize;
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (!geoAnchor || tiles.length === 0) return;

        ctx.imageSmoothingEnabled = true;

        const cache = imageCacheRef.current;
        const ready = (url: string) => {
            const img = cache.get(url);
            if (!img || !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return undefined;
            // Used again: move to the end so it is evicted last.
            cache.delete(url);
            cache.set(url, img);
            return img;
        };
        const o = TILE_OVERLAP_PX;

        for (const { layer: l, z, x, y, url, screenX: sx, screenY: sy, screenSize: size } of tiles) {
            const img = ready(url);
            if (img) {
                ctx.drawImage(img, sx, sy, size + o, size + o);
                continue;
            }

            // Not loaded yet: show what is cached of the zoom levels around, so the picture never goes blank.
            let drawn = false;
            for (let d = 1; d <= MAX_FALLBACK_LEVELS && d <= z && !drawn; d++) {
                const parent = ready(tileUrl(l, z - d, x >> d, y >> d));
                if (!parent) continue;
                const n = 2 ** d;
                const part = TILE_SIZE / n;
                ctx.drawImage(parent, (x % n) * part, (y % n) * part, part, part, sx, sy, size + o, size + o);
                drawn = true;
            }
            if (drawn || z >= MAX_TILE_ZOOM) continue;
            for (let j = 0; j < 2; j++) {
                for (let i = 0; i < 2; i++) {
                    const child = ready(tileUrl(l, z + 1, 2 * x + i, 2 * y + j));
                    if (child) ctx.drawImage(child, sx + (i * size) / 2, sy + (j * size) / 2, size / 2 + o, size / 2 + o);
                }
            }
        }
    }, [geoAnchor, tiles, canvasSize, imageVersion]);

    if (!geoAnchor || layer === "empty") return null;

    return (
        <>
            <canvas
                ref={canvasRef}
                className="absolute inset-0 overflow-hidden pointer-events-none"
                aria-hidden="true"
            />
            {/* The tile terms ask for it on the map. */}
            <div className="pointer-events-none absolute bottom-0 left-24 right-16 truncate bg-surface/70 px-2 py-0.5 text-right text-[10px] text-muted max-md:hidden">
                {TILE_ATTRIBUTION[layer]}
            </div>
        </>
    );
}

export const CanvasMapTileLayer = memo(CanvasMapTileLayerInner);
