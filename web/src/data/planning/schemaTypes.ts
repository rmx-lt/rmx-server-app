import type { ZoneCategory } from "@/config/db-ops/enums";

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
    /** Cached: precomputed number of vertices. */
    vertexCount: number;
    /** Cached: precomputed polygon area (shoelace formula). */
    area: number;
    /** Polygon vertices in draw order. */
    vertices: Array<{ x: number; y: number }>;
}
