/**
 * Geographic projection utilities for canvas ↔ Web-Mercator ↔ tile-coordinate
 * transforms used by the satellite map tile layer.
 *
 * All Web-Mercator values are in metres referenced to the standard EPSG:3857
 * extent (±20 037 508.34 m in both axes).
 *
 * Tile coordinates follow the standard XYZ (slippy-map) scheme where (0,0) is
 * the top-left (north-west) corner of the world at each zoom level and Y
 * increases southward.
 */

/** Circumference of the Earth along the equator in Web-Mercator metres. */
const EARTH_CIRC = 20_037_508.342_789_244;

/** Side length of an ArcGIS World Imagery tile in pixels. */
export const TILE_SIZE = 256;

/**
 * Maximum tile zoom level requested from ArcGIS World Imagery.
 * ArcGIS has reliable global coverage up to zoom 18; beyond that many areas
 * return a "not yet available" placeholder. When the canvas is zoomed in past
 * this level the same zoom-18 tiles are CSS-upscaled instead of requesting
 * higher zoom tiles that don't exist.
 */
export const MAX_TILE_ZOOM = 18;

export interface TileZoomState {
    /** Requested tile zoom level used in URL paths. */
    zoom: number;
    /**
     * Scale multiplier applied to 256px source tiles on screen.
     * - For normal (non-clamped) zoom this is in [1, 2).
     * - Past MAX_TILE_ZOOM this keeps increasing (over-zoom).
     */
    overscale: number;
}

// ── WGS-84 ↔ Web-Mercator ────────────────────────────────────────────────────

/** Convert a WGS-84 longitude (degrees) to a Web-Mercator X (metres). */
export function lonToMercX(lon: number): number {
    return (lon / 180) * EARTH_CIRC;
}

/** Convert a WGS-84 latitude (degrees) to a Web-Mercator Y (metres). */
export function latToMercY(lat: number): number {
    const rad = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2)) * (EARTH_CIRC / Math.PI);
}

// ── Web-Mercator ↔ tile coordinates ─────────────────────────────────────────

/**
 * Number of metres covered by the full world at a given zoom level.
 * Identical in X and Y (the world is square in Web-Mercator).
 */
function worldMetres(zoom: number): number {
    return (EARTH_CIRC * 2) / Math.pow(2, zoom);
}

/** Convert a Web-Mercator X (metres) to a fractional tile column at `zoom`. */
export function mercXToTileX(mx: number, zoom: number): number {
    return (mx + EARTH_CIRC) / worldMetres(zoom);
}

/** Convert a Web-Mercator Y (metres) to a fractional tile row at `zoom`. */
export function mercYToTileY(my: number, zoom: number): number {
    return (EARTH_CIRC - my) / worldMetres(zoom);
}

/** Web-Mercator X of the left edge of tile column `tx` at `zoom`. */
export function tileXToMercX(tx: number, zoom: number): number {
    return tx * worldMetres(zoom) - EARTH_CIRC;
}

/** Web-Mercator Y of the top edge of tile row `ty` at `zoom`. */
export function tileYToMercY(ty: number, zoom: number): number {
    return EARTH_CIRC - ty * worldMetres(zoom);
}

// ── Zoom selection ───────────────────────────────────────────────────────────

/**
 * Mercator scale factor at a given WGS-84 latitude.
 *
 * In the Web-Mercator projection a surface distance of `d` metres maps to
 * `d / cos(φ)` Mercator metres at latitude φ.  Applying this factor when
 * converting between canvas units (surface metres) and Mercator metres keeps
 * the satellite tile layer correctly scaled at any latitude.
 */
function mercatorScaleFactor(latDeg: number): number {
    return 1 / Math.cos((latDeg * Math.PI) / 180);
}

/**
 * Choose the integer tile zoom level that best matches the current canvas
 * zoom and geographic scale.
 *
 * @param scale         Current canvas scale factor (screen pixels per canvas unit).
 * @param metersPerUnit Surface metres represented by one canvas unit.
 * @param lat           WGS-84 latitude of the anchor point (degrees).
 * @returns             Integer zoom in [0, 22].
 */
export function selectTileZoom(scale: number, metersPerUnit: number, lat: number): number {
    // At zoom Z, one tile pixel covers: (2 * EARTH_CIRC) / (TILE_SIZE * 2^Z) Mercator metres.
    // We want that to equal (metersPerUnit * mercScale) / scale Mercator metres per screen pixel.
    // → 2^Z = (2 * EARTH_CIRC * scale) / (TILE_SIZE * metersPerUnit * mercScale)
    const mercScale = mercatorScaleFactor(lat);
    const z = Math.log2((EARTH_CIRC * 2 * scale) / (TILE_SIZE * metersPerUnit * mercScale));
    // Floor so we always pick the coarser zoom — better global coverage and fewer missing tiles.
    // Cap at MAX_TILE_ZOOM: beyond that ArcGIS returns "not yet available" placeholders.
    return Math.min(MAX_TILE_ZOOM, Math.max(0, Math.floor(z)));
}

/**
 * Compute requested tile zoom and overscale factor for stable rendering.
 *
 * This helper is especially useful when `rawZoom > MAX_TILE_ZOOM`:
 * requests stay pinned at `MAX_TILE_ZOOM` while `overscale` continues to grow,
 * so zooming remains smooth without requesting unavailable tiles.
 */
export function getTileZoomState(scale: number, metersPerUnit: number, lat: number): TileZoomState {
    const mercScale = mercatorScaleFactor(lat);
    const rawZoom = Math.log2((EARTH_CIRC * 2 * scale) / (TILE_SIZE * metersPerUnit * mercScale));
    const zoom = Math.min(MAX_TILE_ZOOM, Math.max(0, Math.floor(rawZoom)));
    const overscale = Math.pow(2, rawZoom - zoom);
    return { zoom, overscale };
}

// ── Canvas ↔ screen via geo-anchor ──────────────────────────────────────────

export interface GeoAnchorMerc {
    anchorMx: number;
    anchorMy: number;
    /** WGS-84 latitude of the anchor in degrees — needed for the Mercator scale correction. */
    anchorLat: number;
    metersPerUnit: number;
}

/**
 * Convert a canvas world point (cx, cy) to Web-Mercator metres.
 *
 * The geo-anchor maps canvas origin (0, 0) to a specific Web-Mercator
 * coordinate. Canvas Y increases downward (screen convention), Web-Mercator Y
 * increases upward (geographic convention) — so cy is negated.
 *
 * `metersPerUnit` is a surface distance.  The Mercator projection stretches
 * distances by `1/cos(φ)` at latitude φ, so we apply that factor when
 * converting to Mercator metres.
 */
export function canvasToMerc(
    cx: number,
    cy: number,
    { anchorMx, anchorMy, anchorLat, metersPerUnit }: GeoAnchorMerc,
): { mx: number; my: number } {
    const mercScale = mercatorScaleFactor(anchorLat);
    return {
        mx: anchorMx + cx * metersPerUnit * mercScale,
        my: anchorMy - cy * metersPerUnit * mercScale,
    };
}

/**
 * Convert a Web-Mercator point (mx, my) to a canvas world point (cx, cy).
 */
export function mercToCanvas(
    mx: number,
    my: number,
    { anchorMx, anchorMy, anchorLat, metersPerUnit }: GeoAnchorMerc,
): { cx: number; cy: number } {
    const mercScale = mercatorScaleFactor(anchorLat);
    return {
        cx: (mx - anchorMx) / (metersPerUnit * mercScale),
        cy: -(my - anchorMy) / (metersPerUnit * mercScale),
    };
}
