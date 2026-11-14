import type { CoordSystemType, MapFormat, MapType, ZoneCategory, ZoneType } from "@/config/db-ops/enums";

/**
 * Geographic anchor that binds the canvas world origin (0, 0) to a real-world
 * WGS-84 coordinate. The active UoM setting determines the metres-per-unit
 * mapping used for satellite tile rendering.
 */
export interface GeoAnchor {
    /** WGS-84 latitude of the canvas world origin (0, 0). */
    lat: number;
    /** WGS-84 longitude of the canvas world origin (0, 0). */
    lon: number;
}

export interface MapInfo {
    id: number;
    name: string;
    format: MapFormat;
    type: MapType;
    coordSystem: CoordSystemType;
    headlandEnabled: boolean;
    headlandWidth: string;
    mowingZoneCount: number;
    noGoZoneCount: number;
}

/** Singleton row containing system-level default geo anchor values. */
export interface GeoAnchorSystemRecord {
    /** Fixed PK; the app uses id=1. */
    id: number;
    /** Optional system default anchor. */
    geoAnchor?: GeoAnchor;
}

/** Per-map geo anchor assignment. One row per map. */
export interface MapGeoAnchorRecord {
    /** PK — FK → maps.id */
    mapId: number;
    /** Optional map-specific anchor. */
    geoAnchor?: GeoAnchor;
}

export interface Zone {
    id: number;
    mapId: number;
    category: ZoneCategory;
    /**
     * Vertex winding convention (in screen coordinates, Y increases downward):
     * - `zone`     → vertices inserted **clockwise** (positive signed area)
     * - `no-go zone` → vertices inserted **counter-clockwise** (negative signed area)
     */
    type: ZoneType;
    /** Cached: precomputed number of vertices. */
    vertexCount: number;
    /** Cached: precomputed polygon area (shoelace formula). */
    area: number;
    /** Polygon vertices in draw order. */
    vertices: Array<{ x: number; y: number }>;
}

export type MapPointType = "start" | "end" | "start_end";

export interface MapPoint {
    id?: number;
    mapId: number;
    type: MapPointType;
    point: { x: number; y: number };
}
