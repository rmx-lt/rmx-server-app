import polygonClipping from "polygon-clipping";
import type { Object } from "@/data/local/schemaTypes";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import { computePolygonArea } from "@/utils/geometry";

export interface Point {
    x: number;
    y: number;
}

export interface EdgeMidpoint extends Point {
    /** Index of the edge's start vertex (edge goes from vertices[afterIndex] to vertices[afterIndex+1]) */
    afterIndex: number;
}

/**
 * Computes the midpoint of every edge in a closed polygon.
 * The last edge wraps from the final vertex back to vertices[0].
 */
export function computeEdgeMidpoints(vertices: Array<{ x: number; y: number }>): EdgeMidpoint[] {
    return vertices.map((v, i) => {
        const next = vertices[(i + 1) % vertices.length]!;
        return {
            afterIndex: i,
            x: (v.x + next.x) / 2,
            y: (v.y + next.y) / 2,
        };
    });
}

// ---------------------------------------------------------------------------
// Net area helper
// ---------------------------------------------------------------------------

/** Converts an {x,y}[] polygon to a closed polygon-clipping ring [[x,y],...,[x0,y0]]. */
function toRing(vertices: Array<{ x: number; y: number }>): [number, number][] {
    const ring: [number, number][] = vertices.map((v) => [v.x, v.y]);
    // polygon-clipping requires a closed ring: last point must equal first point
    if (ring.length > 0) ring.push(ring[0]!);
    return ring;
}

/**
 * Computes the net area of a zone object: gross area minus the total area of all
 * obstacle polygons that overlap with it (clipped to the zone boundary).
 *
 * Uses the Martinez-Rueda-Feito algorithm (polygon-clipping library) which correctly
 * handles arbitrary concave polygons. Sutherland-Hodgman was replaced because it only
 * works with convex clip polygons.
 *
 * For obstacle objects the concept of "net area" doesn't apply — returns `null`.
 */
export function computeNetArea(
    obj: Object,
    objects: Object[],
): number | null {
    if (obj.category !== OBJECT_CATEGORY.ZONE) return null;

    const zoneRing = toRing(obj.vertices);

    let overlapArea = 0;
    for (const o of objects) {
        if (o.category !== OBJECT_CATEGORY.OBSTACLE) continue;
        const obstRing = toRing(o.vertices);

        const intersection = polygonClipping.intersection([[zoneRing]], [[obstRing]]);
        for (const polygon of intersection) {
            // polygon[0] is the outer ring; polygon[1+] are holes (subtract them)
            for (let i = 0; i < polygon.length; i++) {
                const ring = polygon[i]!;
                // Drop the closing duplicate before computing area
                const pts = ring.slice(0, -1).map(([x, y]) => ({ x, y }));
                const area = computePolygonArea(pts);
                overlapArea += i === 0 ? area : -area;
            }
        }
    }

    return Math.max(0, obj.area - overlapArea);
}
