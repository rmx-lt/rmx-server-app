import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useLayerSettingsStore, getLayerParam } from "@/model/layerSettingsStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";
import { convertLinearToBase } from "@/utils/unitOfMeasure";
import {
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

/**
 * ArcGIS World Imagery tile URL.
 * No API key required; attribution to Esri et al. must be shown in production.
 * Note: ArcGIS uses z/y/x order (row before column), unlike the standard z/x/y.
 */
function arcgisTileUrl(z: number, x: number, y: number): string {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

interface TileEntry {
    key: string;
    url: string;
    /** Left edge in screen pixels. */
    screenX: number;
    /** Top edge in screen pixels. */
    screenY: number;
    /** Tile side length in screen pixels. */
    screenSize: number;
}

function CanvasMapTileLayerInner() {
    const layers = useLayerSettingsStore((s) => s.layers);
    const visible = getLayerParam(layers, LAYER_ID.SATELLITE_MAP, LAYER_PARAM_KEY.VISIBLE) !== "false";
    const opacityStr = getLayerParam(layers, LAYER_ID.SATELLITE_MAP, LAYER_PARAM_KEY.MAP_OPACITY);
    const opacity = Math.min(100, Math.max(0, Number(opacityStr ?? "100"))) / 100;

    const geoAnchor = useGeoAnchorStore((s) => s.environmentGeoAnchor);
    const unitOfMeasure = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const position = useCanvasViewStore((s) => s.position);
    const scale = useCanvasViewStore((s) => s.scale);
    const canvasSize = useCanvasViewStore((s) => s.canvasSize);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
    const [imageVersion, setImageVersion] = useState(0);

    const tiles = useMemo<TileEntry[]>(() => {
        if (!visible || !geoAnchor) return [];

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
                    key: `${zoom}/${tx}/${ty}`,
                    url: arcgisTileUrl(zoom, tx, ty),
                    screenX,
                    screenY,
                    screenSize: tilePx,
                });
            }
        }

        return result;
    }, [visible, geoAnchor, position, scale, canvasSize, unitOfMeasure]);

    useEffect(() => {
        if (!visible || tiles.length === 0) return;

        let cancelled = false;

        for (const tile of tiles) {
            if (imageCacheRef.current.has(tile.url)) continue;

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
            imageCacheRef.current.set(tile.url, img);
        }

        return () => {
            cancelled = true;
        };
    }, [visible, tiles]);

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
        if (!visible || !geoAnchor || tiles.length === 0) return;

        ctx.globalAlpha = opacity;
        ctx.imageSmoothingEnabled = true;

        for (const tile of tiles) {
            const img = imageCacheRef.current.get(tile.url);
            if (!img || !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) continue;
            ctx.drawImage(
                img,
                tile.screenX,
                tile.screenY,
                tile.screenSize + TILE_OVERLAP_PX,
                tile.screenSize + TILE_OVERLAP_PX,
            );
        }
    }, [visible, geoAnchor, tiles, canvasSize, opacity, imageVersion]);

    if (!visible || !geoAnchor) return null;

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 overflow-hidden pointer-events-none"
            aria-hidden="true"
        />
    );
}

export const CanvasMapTileLayer = memo(CanvasMapTileLayerInner);
