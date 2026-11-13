/**
 * Arrow geometry utilities for Konva line layer renderers.
 *
 * Arrow shape values are Google Material Icon names serialised in kebab‑case,
 * matching the LineArrowStartEnum / LineArrowEndEnum / LineArrowMidEnum
 * from the provider spec.
 *
 * "notch" variants render an open chevron; plain variants render a filled head.
 */

export interface ArrowPoint {
    x: number;
    y: number;
}

/**
 * Returns the flat Konva `points` array for an arrowhead centered at (cx, cy),
 * pointing in the direction given by angle (radians, 0 = right).
 *
 * `isNotch = true`  → open chevron (two lines)
 * `isNotch = false` → filled triangle
 */
export function arrowHeadPoints(
    cx: number,
    cy: number,
    angle: number,
    size: number,
    isNotch: boolean,
): number[] {
    const half = size / 2;
    if (isNotch) {
        // Chevron: left wing tip, apex, right wing tip
        const lx = cx + Math.cos(angle + Math.PI * 0.75) * size;
        const ly = cy + Math.sin(angle + Math.PI * 0.75) * size;
        const rx = cx + Math.cos(angle - Math.PI * 0.75) * size;
        const ry = cy + Math.sin(angle - Math.PI * 0.75) * size;
        return [lx, ly, cx, cy, rx, ry];
    }
    // Filled triangle: apex and two base corners
    const ax = cx + Math.cos(angle) * size;
    const ay = cy + Math.sin(angle) * size;
    const bx = cx + Math.cos(angle + Math.PI * 0.8) * half;
    const by = cy + Math.sin(angle + Math.PI * 0.8) * half;
    const ex = cx + Math.cos(angle - Math.PI * 0.8) * half;
    const ey = cy + Math.sin(angle - Math.PI * 0.8) * half;
    return [ax, ay, bx, by, ex, ey];
}

/** Returns true when the arrow enum value is a "notch" (open chevron) variant. */
export function isNotchArrow(value: string): boolean {
    return value.endsWith("_notch");
}

/** Returns true when the arrow enum value points toward the start of the segment. */
export function isStartArrow(value: string): boolean {
    return value.startsWith("line_start_");
}

/**
 * Computes angle (radians) of the vector from p1 → p2.
 */
export function segmentAngle(p1: ArrowPoint, p2: ArrowPoint): number {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * Returns the positions and angles for mid-arrows on a segment with the
 * given length, following the spec formula:
 *
 *   n = max(1, floor(L / S) - 1)
 *   pos(i) = L/2 + (i − (n−1)/2) × S   for i = 0…n−1
 *
 * Returns an array of t values (0–1) along the segment.
 */
export function midArrowPositions(segmentLength: number, spacing: number): number[] {
    if (segmentLength <= 0 || spacing <= 0) return [];
    const n = Math.max(1, Math.floor(segmentLength / spacing) - 1);
    const positions: number[] = [];
    for (let i = 0; i < n; i++) {
        const pos = segmentLength / 2 + (i - (n - 1) / 2) * spacing;
        positions.push(pos / segmentLength); // normalise to [0,1]
    }
    return positions;
}

/**
 * Interpolates a point at parameter t (0–1) along the polyline defined by
 * the flat [x0,y0, x1,y1, …] points array.
 * Returns { point, angle } where angle is the tangent direction at that t.
 */
export function interpolatePolyline(
    flatPoints: number[],
    t: number,
): { point: ArrowPoint; angle: number } {
    const coords: ArrowPoint[] = [];
    for (let i = 0; i + 1 < flatPoints.length; i += 2) {
        coords.push({ x: flatPoints[i] as number, y: flatPoints[i + 1] as number });
    }
    if (coords.length < 2) return { point: coords[0] ?? { x: 0, y: 0 }, angle: 0 };

    // Total arc length
    const lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1]!;
        const curr = coords[i]!;
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        total += len;
        lengths.push(total);
    }

    const target = t * total;
    let acc = 0;
    for (let i = 0; i < lengths.length; i++) {
        const segEnd = lengths[i]!;
        const segLen = segEnd - acc;
        if (target <= segEnd || i === lengths.length - 1) {
            const localT = segLen > 0 ? (target - acc) / segLen : 0;
            const a = coords[i]!;
            const b = coords[i + 1] ?? a;
            return {
                point: {
                    x: a.x + (b.x - a.x) * localT,
                    y: a.y + (b.y - a.y) * localT,
                },
                angle: Math.atan2(b.y - a.y, b.x - a.x),
            };
        }
        acc = segEnd;
    }
    return { point: coords[coords.length - 1] ?? { x: 0, y: 0 }, angle: 0 };
}

/**
 * Total arc length of a flat [x0,y0, x1,y1, …] points array.
 */
export function polylineLength(flatPoints: number[]): number {
    let total = 0;
    for (let i = 2; i + 1 < flatPoints.length; i += 2) {
        const dx = (flatPoints[i] as number) - (flatPoints[i - 2] as number);
        const dy = (flatPoints[i + 1] as number) - (flatPoints[i - 1] as number);
        total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
}
