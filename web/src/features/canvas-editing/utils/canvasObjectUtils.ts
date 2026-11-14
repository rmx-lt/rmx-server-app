import type { Zone } from "@/data/planning/schemaTypes";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import { computePolygonArea, ensureWinding } from "@/utils/geometry";

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

/**
 * Enforces winding order and recomputes vertexCount + area for a single object.
 * This is the single source of truth for all post-mutation normalization.
 */
export function normalizeObject(o: Zone): Zone {
    const vertices = o.vertices.length >= 3 ? ensureWinding(o.vertices, o.category) : o.vertices;
    return { ...o, vertices, vertexCount: vertices.length, area: vertices.length >= 3 ? computePolygonArea(vertices) : 0 };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * After any mutation to an object's vertices, call this to enforce winding and
 * recompute vertexCount + area.
 */
export function syncObject(objects: Zone[], objectId: number): Zone[] {
    return objects.map((o) => o.id === objectId ? normalizeObject(o) : o);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** True when two objects share the same compound primary key [id, mapId]. */
export function sameObject(a: Zone, b: Zone): boolean {
    return a.id === b.id && a.mapId === b.mapId;
}

/** True when two VertexRefs refer to the same vertex position. */
export function sameVertexRef(a: VertexRef, b: VertexRef): boolean {
    return a.objectId === b.objectId && a.index === b.index;
}

// ---------------------------------------------------------------------------
// Dirty tracking (dirty and deleted are mutually exclusive per id)
// ---------------------------------------------------------------------------

export function markDirty(
    dirty: Zone[],
    deleted: Zone[],
    obj: Zone,
): { dirty: Zone[]; deleted: Zone[] } {
    return {
        dirty: [...dirty.filter((o) => o.id !== obj.id), obj],
        deleted: deleted.filter((o) => o.id !== obj.id),
    };
}

export function markDeleted(
    dirty: Zone[],
    deleted: Zone[],
    obj: Zone,
): { dirty: Zone[]; deleted: Zone[] } {
    return {
        dirty: dirty.filter((o) => o.id !== obj.id),
        deleted: [...deleted.filter((o) => o.id !== obj.id), obj],
    };
}
