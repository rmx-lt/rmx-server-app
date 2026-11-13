import type {
    ComputeResultRecord,
    ComputationAlgorithmParameter,
    CoverageGridVisitEntry,
    Object as CanvasObject,
} from "@/data/local/schemaTypes";
import type { AlgorithmParameter, CoveragePathPlanSegment } from "@/data/local/serviceTypes";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";

export interface ResolvePathWidthInput {
    result: ComputeResultRecord | null;
    catalogParams: AlgorithmParameter[];
    parameterValues: ComputationAlgorithmParameter[];
    fallback: number;
}

export interface BuildCoverageVisitMapInput {
    segments: CoveragePathPlanSegment[];
    cellSize: number;
    pathWidth: number;
}

export interface CoverageVisitMapResult {
    visitMap: Map<string, number>;
    maxCount: number;
}

export interface ComputeCoverageRatioInput {
    visitMap: Map<string, number>;
    cellSize: number;
    objects: CanvasObject[];
}

/** Squared distance from point (px, py) to segment (ax, ay)->(bx, by). */
export function distSqPointToSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        const ex = px - ax;
        const ey = py - ay;
        return ex * ex + ey * ey;
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx - px;
    const cy = ay + t * dy - py;
    return cx * cx + cy * cy;
}

/** Strip trailing alpha from an 8-char hex color (e.g. #0ea5e922 -> #0ea5e9). */
export function stripHexAlpha(hex: string): string {
    if (hex.length === 9 && hex[0] === "#") {
        return hex.slice(0, 7);
    }
    return hex;
}

/** Returns alpha as [0..1] when color is #RRGGBBAA; otherwise null. */
export function parseHexAlphaOpacity(hex: string): number | null {
    if (!/^#[0-9a-fA-F]{8}$/.test(hex)) {
        return null;
    }

    const alphaHex = hex.slice(7, 9);
    const alpha = Number.parseInt(alphaHex, 16);
    if (!Number.isFinite(alpha)) {
        return null;
    }

    return alpha / 255;
}

/** Resolves numeric Path Width from catalog metadata + per-environment parameter values. */
export function resolvePathWidth(input: ResolvePathWidthInput): number {
    const { result, catalogParams, parameterValues, fallback } = input;
    if (!result) return fallback;

    const { algorithmId, providerId, environmentId } = result;

    const param = catalogParams.find(
        (p) => p.name === "Path Width" && p.algorithmId === algorithmId && p.computationProviderId === providerId,
    );
    if (!param) return fallback;

    const persisted = parameterValues.find(
        (v) =>
            v.id === param.id &&
            v.algorithmId === algorithmId &&
            v.providerId === providerId &&
            v.environmentId === environmentId,
    );

    const parsed = parseFloat(persisted?.value ?? param.defaultValue);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ─── Heatmap coloring ────────────────────────────────────────────────────────

type RGB = [number, number, number];

const HEATMAP_STOPS: [number, RGB][] = [
    [0.00, [13, 0, 17]],    // near-black
    [0.25, [81, 18, 124]],  // dark purple
    [0.50, [184, 50, 137]], // magenta/pink
    [0.75, [251, 135, 97]], // orange
    [1.00, [252, 253, 191]],// pale yellow
];

function lerpRGB(c0: RGB, c1: RGB, t: number): string {
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
    return `rgb(${r},${g},${b})`;
}

/**
 * Maps a normalized intensity t ∈ [0, 1] to an RGB heatmap color
 * (blue → green → red).
 */
export function heatmapColor(t: number): string {
    const clamped = Math.max(0, Math.min(1, t));
    for (let i = 1; i < HEATMAP_STOPS.length; i++) {
        const [s0, c0] = HEATMAP_STOPS[i - 1]!;
        const [s1, c1] = HEATMAP_STOPS[i]!;
        if (clamped <= s1) {
            const localT = (clamped - s0) / (s1 - s0);
            return lerpRGB(c0, c1, localT);
        }
    }
    return "rgb(252,253,191)";
}

/** Iterative max scan (stack-safe for large maps). */
export function computeMaxVisitCount(visitMap: Map<string, number>): number {
    let max = 0;
    for (const count of visitMap.values()) {
        if (count > max) max = count;
    }
    return max;
}

/** Builds visit counts per coverage cell using path-width banding around each segment. */
export function buildCoverageVisitMap(input: BuildCoverageVisitMapInput): CoverageVisitMapResult {
    const { segments, cellSize, pathWidth } = input;
    const visitMap = new Map<string, number>();

    const cellWorld = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;
    const width = Number.isFinite(pathWidth) && pathWidth > 0 ? pathWidth : cellWorld;

    const halfWidth = width / 2;
    const halfSq = halfWidth * halfWidth;

    const CONTIGUITY_EPSILON_SQ = 1e-12;
    let previousEdgeCells: Set<string> | null = null;
    let previousEdgeEndPoint: { x: number; y: number } | null = null;

    for (const segment of segments) {
        const path = segment.path;
        for (let i = 0; i + 1 < path.length; i++) {
            const p0 = path[i]!.point;
            const p1 = path[i + 1]!.point;
            const currentEdgeCells = new Set<string>();
            const currentEdgeCellCenters = new Map<string, { x: number; y: number }>();

            if (previousEdgeEndPoint) {
                const dx = p0.x - previousEdgeEndPoint.x;
                const dy = p0.y - previousEdgeEndPoint.y;
                if (dx * dx + dy * dy > CONTIGUITY_EPSILON_SQ) {
                    previousEdgeCells = null;
                }
            }

            const minCol = Math.floor((Math.min(p0.x, p1.x) - halfWidth) / cellWorld);
            const maxCol = Math.floor((Math.max(p0.x, p1.x) + halfWidth) / cellWorld);
            const minRow = Math.floor((Math.min(p0.y, p1.y) - halfWidth) / cellWorld);
            const maxRow = Math.floor((Math.max(p0.y, p1.y) + halfWidth) / cellWorld);

            for (let col = minCol; col <= maxCol; col++) {
                for (let row = minRow; row <= maxRow; row++) {
                    const cx = (col + 0.5) * cellWorld;
                    const cy = (row + 0.5) * cellWorld;
                    if (distSqPointToSegment(cx, cy, p0.x, p0.y, p1.x, p1.y) <= halfSq) {
                        const key = `${col},${row}`;
                        currentEdgeCells.add(key);
                        currentEdgeCellCenters.set(key, { x: cx, y: cy });
                    }
                }
            }

            for (const key of currentEdgeCells) {
                // Adjacent edges in the same polyline share a vertex; avoid counting
                // only the shared-vertex cap cells twice for a single physical pass.
                if (previousEdgeCells?.has(key)) {
                    const center = currentEdgeCellCenters.get(key)!;
                    const dx = center.x - p0.x;
                    const dy = center.y - p0.y;
                    if (dx * dx + dy * dy <= halfSq) continue;
                }
                visitMap.set(key, (visitMap.get(key) ?? 0) + 1);
            }

            previousEdgeCells = currentEdgeCells;
            previousEdgeEndPoint = p1;
        }
    }

    return {
        visitMap,
        maxCount: computeMaxVisitCount(visitMap),
    };
}

function pointInPolygon(x: number, y: number, vertices: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const vi = vertices[i]!;
        const vj = vertices[j]!;
        const intersects =
            (vi.y > y) !== (vj.y > y) &&
            x < ((vj.x - vi.x) * (y - vi.y)) / (vj.y - vi.y + Number.EPSILON) + vi.x;
        if (intersects) inside = !inside;
    }
    return inside;
}

/** Returns (total visits / unique visited cells * 100) - 100. 0% = no overlap, 50% = cells visited 1.5× on average. null if nothing was visited. */
export function computeOverlapRatio(visitMap: Map<string, number>): number | null {
    if (visitMap.size === 0) return null;
    let totalVisits = 0;
    for (const count of visitMap.values()) {
        totalVisits += count;
    }
    return (totalVisits / visitMap.size) * 100 - 100;
}

/** Counts turns as total accumulated direction-change angle divided by 90°, floored to a whole number. */
export function computeNumberOfTurns(segments: CoveragePathPlanSegment[]): number {
    let totalAngle = 0;
    let prevDx: number | null = null;
    let prevDy: number | null = null;
    let prevX: number | null = null;
    let prevY: number | null = null;

    for (const segment of segments) {
        for (const { point } of segment.path) {
            if (prevX === null || prevY === null) {
                prevX = point.x;
                prevY = point.y;
                continue;
            }

            const dx = point.x - prevX;
            const dy = point.y - prevY;
            if (dx === 0 && dy === 0) continue;

            if (prevDx !== null && prevDy !== null) {
                const dot = prevDx * dx + prevDy * dy;
                const prevMag = Math.sqrt(prevDx ** 2 + prevDy ** 2);
                const currMag = Math.sqrt(dx ** 2 + dy ** 2);
                const cos = Math.max(-1, Math.min(1, dot / (prevMag * currMag)));
                totalAngle += Math.acos(cos) * (180 / Math.PI);
            }

            prevDx = dx;
            prevDy = dy;
            prevX = point.x;
            prevY = point.y;
        }
    }

    return Math.floor(totalAngle / 90);
}

/** Computes the total Euclidean path length across all segments, skipping consecutive duplicate points. */
export function computePathLength(segments: CoveragePathPlanSegment[]): number {
    let totalLength = 0;
    let prevX: number | null = null;
    let prevY: number | null = null;
    for (const segment of segments) {
        for (const { point } of segment.path) {
            if (point.x === prevX && point.y === prevY) continue;
            if (prevX !== null && prevY !== null) {
                const dx = point.x - prevX;
                const dy = point.y - prevY;
                totalLength += Math.sqrt(dx * dx + dy * dy);
            }
            prevX = point.x;
            prevY = point.y;
        }
    }
    return totalLength;
}

/**
 * Computes coverage efficiency as a percentage.
 *
 * Efficiency = (minimum path length required / actual path length) × 100
 * Minimum path length = coveredArea / pathWidth
 *
 * coveredArea is the portion of the work area that was actually covered
 * (coverageRatio × totalNetArea), so efficiency reflects how optimally
 * the robot covered the area it did cover, not the full field.
 *
 * Returns null when any input is zero or non-finite.
 */
export function computeEfficiency(
    coveredArea: number,
    pathWidth: number,
    pathLength: number,
): number | null {
    if (
        !Number.isFinite(coveredArea) || coveredArea <= 0 ||
        !Number.isFinite(pathWidth) || pathWidth <= 0 ||
        !Number.isFinite(pathLength) || pathLength <= 0
    ) {
        return null;
    }
    const minPathLength = coveredArea / pathWidth;
    return (minPathLength / pathLength) * 100;
}

export function computeCoverageRatio(input: ComputeCoverageRatioInput): number | null {
    const { visitMap, cellSize, objects } = input;
    const cellWorld = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;

    const zones = objects.filter((o) => o.category === OBJECT_CATEGORY.ZONE && o.vertices.length >= 3);
    if (zones.length === 0) return null;
    const obstacles = objects.filter((o) => o.category === OBJECT_CATEGORY.OBSTACLE && o.vertices.length >= 3);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const z of zones) {
        for (const v of z.vertices) {
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
        }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
        return null;
    }

    const minCol = Math.floor(minX / cellWorld);
    const maxCol = Math.floor(maxX / cellWorld);
    const minRow = Math.floor(minY / cellWorld);
    const maxRow = Math.floor(maxY / cellWorld);

    let totalWorkCells = 0;
    let coveredWorkCells = 0;

    for (let col = minCol; col <= maxCol; col++) {
        for (let row = minRow; row <= maxRow; row++) {
            const cx = (col + 0.5) * cellWorld;
            const cy = (row + 0.5) * cellWorld;

            const inZone = zones.some((z) => pointInPolygon(cx, cy, z.vertices));
            if (!inZone) continue;
            const inObstacle = obstacles.some((o) => pointInPolygon(cx, cy, o.vertices));
            if (inObstacle) continue;

            totalWorkCells += 1;
            if ((visitMap.get(`${col},${row}`) ?? 0) > 0) {
                coveredWorkCells += 1;
            }
        }
    }

    if (totalWorkCells === 0) return null;
    return coveredWorkCells / totalWorkCells;
}

export function serializeVisitMap(visitMap: Map<string, number>): CoverageGridVisitEntry[] {
    const entries: CoverageGridVisitEntry[] = [];
    for (const [key, count] of visitMap.entries()) {
        entries.push({ key, count });
    }
    return entries;
}

export function deserializeVisitEntries(entries: CoverageGridVisitEntry[]): Map<string, number> {
    const visitMap = new Map<string, number>();
    for (const entry of entries) {
        visitMap.set(entry.key, entry.count);
    }
    return visitMap;
}

function hashString(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
        hash = (hash * 33) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

/** Stable signature for cache-keying coverage derivations for a specific compute output. */
export function computeResultSignature(result: ComputeResultRecord): string {
    const segmentsJson = JSON.stringify(result.result.coveragePathPlan.segments);
    const segmentsHash = hashString(segmentsJson);
    return `${result.environmentId}:${result.providerId}:${result.algorithmId}:${result.jobId}:${result.completedAt}:${segmentsHash}`;
}
