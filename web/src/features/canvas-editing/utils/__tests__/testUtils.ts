import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";

/**
 * Ray casting algorithm to determine if a point is inside a polygon.
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
    if (polygon.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i]!.x, yi = polygon[i]!.y;
        const xj = polygon[j]!.x, yj = polygon[j]!.y;

        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Computes the signed area of a polygon using the shoelace formula.
 * Negative area = CCW (counter-clockwise), Positive area = CW (clockwise).
 */
export function computeSignedArea(polygon: Point[]): number {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i]!.x * polygon[j]!.y;
        area -= polygon[j]!.x * polygon[i]!.y;
    }
    return area / 2;
}

/**
 * Computes the absolute area of a polygon.
 */
export function computePolygonArea(polygon: Point[]): number {
    return Math.abs(computeSignedArea(polygon));
}

/**
 * Checks if a polygon is counter-clockwise (CCW).
 * In screen coordinates (Y down), CCW has negative signed area.
 */
export function isPolygonCCW(polygon: Point[]): boolean {
    return computeSignedArea(polygon) < 0;
}

/**
 * Checks if a polygon is clockwise (CW).
 * In screen coordinates (Y down), CW has positive signed area.
 */
export function isPolygonCW(polygon: Point[]): boolean {
    return computeSignedArea(polygon) > 0;
}

/**
 * Checks if a polygon forms a closed loop (first point ≈ last point).
 * Default tolerance of 1.5 pixels accounts for grid-based quantization.
 */
export function isPolygonClosed(polygon: Point[], tolerance: number = 1.5): boolean {
    if (polygon.length < 2) return false;
    const first = polygon[0]!;
    const last = polygon[polygon.length - 1]!;
    // Euclidean distance tolerance
    const distSq = (first.x - last.x) ** 2 + (first.y - last.y) ** 2;
    return Math.sqrt(distSq) <= tolerance;
}

/**
 * Checks if all vertices of a polygon are within specified bounds.
 */
export function areAllPointsWithinBounds(
    polygon: Point[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): boolean {
    return polygon.every(
        (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
    );
}

/**
 * Calculates the bounding box of a polygon.
 */
export function getBoundingBox(polygon: Point[]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
} | null {
    if (polygon.length === 0) return null;

    let minX = polygon[0]!.x, maxX = polygon[0]!.x;
    let minY = polygon[0]!.y, maxY = polygon[0]!.y;

    for (const p of polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Calculates the minimum distance between two points.
 */
export function distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Finds the minimum distance from a point to a polygon.
 * (Used to validate start point placement.)
 */
export function minDistanceToPolygon(point: Point, polygon: Point[]): number {
    if (polygon.length === 0) return Infinity;

    let minDist = Infinity;

    // Distance to vertices
    for (const v of polygon) {
        minDist = Math.min(minDist, distance(point, v));
    }

    // Distance to edges
    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i]!;
        const p2 = polygon[(i + 1) % polygon.length]!;
        const d = distanceToLineSegment(point, p1, p2);
        minDist = Math.min(minDist, d);
    }

    return minDist;
}

/**
 * Calculates the distance from a point to a line segment.
 */
function distanceToLineSegment(point: Point, p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len2 = dx * dx + dy * dy;

    if (len2 === 0) return distance(point, p1);

    let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const closest = {
        x: p1.x + t * dx,
        y: p1.y + t * dy,
    };

    return distance(point, closest);
}

/**
 * Validates that obstacles don't overlap with the boundary.
 * (Basic check; doesn't handle all edge cases.)
 */
export function validateNoOverlap(boundary: Point[], obstacles: Point[][]): boolean {
    for (const obstacle of obstacles) {
        // Check if any obstacle vertex is inside or on the boundary
        for (const vertex of obstacle) {
            if (isPointInPolygon(vertex, boundary)) {
                return false; // Vertex inside boundary = potential issue
            }
        }
    }
    return true;
}

/**
 * Seeded PRNG — mulberry32 (32-bit)
 */
export function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Converts a 32-bit number to a hex seed string (e.g. "0xDEADBEEF").
 */
export function toHexSeed(value: number): string {
    return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Computes the actual obstacle ratio percentage by sampling cell centers.
 * A cell is counted as obstacle if it's outside the boundary or inside an obstacle polygon.
 */
export function computeActualObstacleRatioPct(
    boundary: Point[],
    obstacles: Point[][],
    cellSize: number,
    cols: number,
    rows: number,
): number {
    let obstacleCells = 0;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const point = {
                x: (col + 0.5) * cellSize,
                y: (row + 0.5) * cellSize,
            };

            const insideBoundary = isPointInPolygon(point, boundary);
            const insideObstacle = obstacles.some((polygon) => isPointInPolygon(point, polygon));
            if (!insideBoundary || insideObstacle) obstacleCells++;
        }
    }

    return (obstacleCells / (cols * rows)) * 100;
}
