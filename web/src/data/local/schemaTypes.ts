import type { CoordSystemType, EnvFormat, EnvType, ObjectCategory, ObjectType } from "@/config/db-ops/enums";
import type { ComputeResult } from "@/data/local/serviceTypes";

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

export interface ComputationSelection {
    environmentId: number;
    selectedProviderId: number | null;
    selectedAlgorithmId: number | null;
}

export interface ComputationAlgorithmParameter {
    id: number;
    environmentId: number;
    providerId: number;
    algorithmId: number;
    value: string;
}

export interface Environment {
    id: number;
    name: string;
    format: EnvFormat;
    type: EnvType;
    coordSystem: CoordSystemType;
    headlandEnabled: boolean;
    headlandWidth: string;
    zoneCount: number;
    obstacleCount: number;
}

/** Singleton row containing system-level default geo anchor values. */
export interface GeoAnchorSystemRecord {
    /** Fixed PK; the app uses id=1. */
    id: number;
    /** Optional system default anchor. */
    geoAnchor?: GeoAnchor;
}

/** Per-environment geo anchor assignment. One row per environment. */
export interface EnvironmentGeoAnchorRecord {
    /** PK — FK → environments.id */
    environmentId: number;
    /** Optional environment-specific anchor. */
    geoAnchor?: GeoAnchor;
}

export interface Object {
    id: number;
    environmentId: number;
    category: ObjectCategory;
    /**
     * Vertex winding convention (in screen coordinates, Y increases downward):
     * - `zone`     → vertices inserted **clockwise** (positive signed area)
     * - `obstacle` → vertices inserted **counter-clockwise** (negative signed area)
     */
    type: ObjectType;
    /** Cached: precomputed number of vertices. */
    vertexCount: number;
    /** Cached: precomputed polygon area (shoelace formula). */
    area: number;
    /** Polygon vertices in draw order. */
    vertices: Array<{ x: number; y: number }>;
}

export type EnvPointType = "start" | "end" | "start_end";

export interface EnvPoint {
    id?: number;
    environmentId: number;
    type: EnvPointType;
    point: { x: number; y: number };
}

/** Per-environment working compute result. One row per environment; replaced on every successful compute. */
export interface ComputeResultRecord {
    /** PK — FK → environments.id */
    environmentId: number;
    jobId: string;
    algorithmId: number;
    providerId: number;
    algorithmName: string;
    completedAt: string;
    result: ComputeResult;
}

/** Sparse serialized coverage-grid visit map entry: key = "col,row", count = visit count. */
export interface CoverageGridVisitEntry {
    key: string;
    count: number;
}

/** Per-environment latest cached coverage-grid visits and derived metrics (single row per environment). */
export interface CoverageGridVisitCacheRecord {
    environmentId: number;
    resultSignature: string;
    cellSize: number;
    pathWidth: number;
    visitEntries: CoverageGridVisitEntry[];
    maxCount: number;
    coverageRatioPct: number | null;
    overlapRatioPct: number | null;
    turnCount: number | null;
    pathLength: number | null;
    efficiency: number | null;
    createdAt: string;
}
