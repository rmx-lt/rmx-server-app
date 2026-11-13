import type { Object } from "@/data/local/schemaTypes";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import { computePolygonArea, ensureWinding } from "@/utils/geometry";

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

/**
 * Enforces winding order and recomputes vertexCount + area for a single object.
 * This is the single source of truth for all post-mutation normalization.
 */
export function normalizeObject(o: Object): Object {
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
export function syncObject(objects: Object[], objectId: number): Object[] {
    return objects.map((o) => o.id === objectId ? normalizeObject(o) : o);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** True when two objects share the same compound primary key [id, environmentId]. */
export function sameObject(a: Object, b: Object): boolean {
    return a.id === b.id && a.environmentId === b.environmentId;
}

/** True when two VertexRefs refer to the same vertex position. */
export function sameVertexRef(a: VertexRef, b: VertexRef): boolean {
    return a.objectId === b.objectId && a.index === b.index;
}

// ---------------------------------------------------------------------------
// Dirty tracking (dirty and deleted are mutually exclusive per id)
// ---------------------------------------------------------------------------

export function markDirty(
    dirty: Object[],
    deleted: Object[],
    obj: Object,
): { dirty: Object[]; deleted: Object[] } {
    return {
        dirty: [...dirty.filter((o) => o.id !== obj.id), obj],
        deleted: deleted.filter((o) => o.id !== obj.id),
    };
}

export function markDeleted(
    dirty: Object[],
    deleted: Object[],
    obj: Object,
): { dirty: Object[]; deleted: Object[] } {
    return {
        dirty: dirty.filter((o) => o.id !== obj.id),
        deleted: [...deleted.filter((o) => o.id !== obj.id), obj],
    };
}
