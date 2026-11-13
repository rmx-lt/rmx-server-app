type Pt = { x: number; y: number };

export interface VertexModifierParams {
    /** Scale factor for vertex count. 1 = no change, < 1 = remove, > 1 = add. Must be > 0. */
    multiplier: number;
    /** Maximum perpendicular displacement applied to newly inserted vertices. 0 = midpoint only. */
    maxRandomOffset: number;
}

/**
 * Returns a new vertex array after applying add/remove according to `params`.
 *
 * - `multiplier < 1` removes vertices via uniform decimation (preserves shape envelope).
 * - `multiplier > 1` inserts new vertices at the longest available edges, optionally
 *   displaced perpendicularly by up to `maxRandomOffset` in either direction.
 * - Result is always clamped to a minimum of 3 vertices.
 * - When multiplier results in no change, returns the **same array reference** so
 *   callers can skip committing an unnecessary dirty mutation.
 */
export function computeModifiedVertices(vertices: Pt[], params: VertexModifierParams): Pt[] {
    const { multiplier, maxRandomOffset } = params;
    if (multiplier <= 0) return vertices;

    const n = vertices.length;
    const target = Math.max(3, Math.round(n * multiplier));

    if (target === n) return vertices;
    if (target > n) return insertVertices(vertices, target, maxRandomOffset);
    return decimateVertices(vertices, target);
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/**
 * Grows the polygon to `target` vertices by repeatedly splitting the longest edge.
 * When `maxRandomOffset > 0`, each new vertex is displaced perpendicularly within
 * the range `[-maxRandomOffset, +maxRandomOffset]`.
 */
function insertVertices(vertices: Pt[], target: number, maxOffset: number): Pt[] {
    const pts = vertices.slice();

    while (pts.length < target) {
        // Find the index of the current longest edge
        let longestIdx = 0;
        let longestLen = -1;
        for (let j = 0; j < pts.length; j++) {
            const a = pts[j]!;
            const b = pts[(j + 1) % pts.length]!;
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len > longestLen) {
                longestLen = len;
                longestIdx = j;
            }
        }

        const a = pts[longestIdx]!;
        const b = pts[(longestIdx + 1) % pts.length]!;

        // Midpoint
        let mx = (a.x + b.x) / 2;
        let my = (a.y + b.y) / 2;

        // Optional perpendicular displacement
        if (maxOffset > 0) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const edgeLen = Math.hypot(dx, dy);
            if (edgeLen > 0) {
                // Perpendicular unit vector: rotate 90° CCW
                const nx = -dy / edgeLen;
                const ny = dx / edgeLen;
                const offset = (Math.random() * 2 - 1) * maxOffset;
                mx += nx * offset;
                my += ny * offset;
            }
        }

        // Insert after longestIdx (appending handles the closing edge correctly)
        pts.splice(longestIdx + 1, 0, { x: mx, y: my });
    }

    return pts;
}

// ---------------------------------------------------------------------------
// Decimate
// ---------------------------------------------------------------------------

/**
 * Reduces the polygon to `target` vertices by keeping evenly distributed indices.
 * This uniform spacing preserves overall shape better than removing adjacent vertices.
 */
function decimateVertices(vertices: Pt[], target: number): Pt[] {
    const n = vertices.length;
    const result: Pt[] = [];
    for (let i = 0; i < target; i++) {
        const idx = Math.round((i * n) / target) % n;
        result.push(vertices[idx]!);
    }
    return result;
}
