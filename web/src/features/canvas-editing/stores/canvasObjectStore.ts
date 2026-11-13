import { create } from "zustand";
import type { Object } from "@/data/local/schemaTypes";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { type ObjectCategory, type ObjectType } from "@/config/db-ops/enums";
import { useEnvStore } from "@/model/envStore";
import { syncObject, normalizeObject, markDirty, markDeleted } from "@/features/canvas-editing/utils/canvasObjectUtils";
import { computeModifiedVertices } from "@/features/canvas-editing/utils/vertexModifier";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

type MutationState = Pick<CanvasObjectState, "objects" | "dirtyObjects" | "deletedObjects">;

/**
 * Applies syncObject (winding + stats) to the object at objectId, marks it dirty,
 * and returns the updated slice of store state. Used by every mutation that modifies vertices.
 */
function commitObject(state: MutationState, pending: Object[], objectId: number): MutationState {
    const objects = syncObject(pending, objectId);
    const obj = objects.find((o) => o.id === objectId)!;
    const { dirty: dirtyObjects, deleted: deletedObjects } = markDirty(state.dirtyObjects, state.deletedObjects, obj);
    return { objects, dirtyObjects, deletedObjects };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface CanvasObjectState {
    objects: Object[];

    dirtyObjects: Object[];
    deletedObjects: Object[];

    /** Adds a new polygon object with the given vertices. Marks object dirty. */
    addObject: (category: ObjectCategory, points: Point[], type: ObjectType) => void;
    /** Removes an object. Marks it as deleted. */
    deleteObject: (obj: Object) => void;
    /** Updates x,y of a single vertex during drag — no sync, no dirty tracking. Call finalizeVertexMoveAt on drag end. */
    moveVertexAt: (ref: VertexRef, pos: Point) => void;
    /** Runs syncObject + marks dirty once after a vertex drag completes. */
    finalizeVertexMoveAt: (ref: VertexRef) => void;
    /** Translates all vertices of an object by (dx, dy). Marks object dirty. */
    moveObject: (obj: Object, dx: number, dy: number) => void;
    /** Removes a vertex by index from an object. No-op when the object has ≤ 3 vertices. */
    deleteVertex: (obj: Object, index: number) => void;
    /** Removes multiple vertices by VertexRef. No-op when the result would have fewer than 3 vertices. */
    deleteVertices: (obj: Object, refs: VertexRef[]) => void;
    /** Inserts a new vertex after afterIndex. Returns the VertexRef for the new vertex. */
    insertVertex: (objectId: number, afterIndex: number, pos: Point) => VertexRef;
    /**
     * Batch-modifies the vertices of a polygon object.
     * `multiplier` scales the vertex count (< 1 removes, > 1 adds, = 1 no-op).
     * `maxRandomOffset` is the maximum perpendicular displacement for newly inserted vertices.
     */
    modifyObjectVertices: (objectId: number, multiplier: number, maxRandomOffset: number) => void;
    /** Updates the type of a single object. Marks it dirty. */
    updateObjectType: (obj: Object, type: ObjectType) => void;
    /** Bulk-updates the type of every object. Marks all dirty. */
    updateObjectsType: (type: ObjectType) => void;
    /** Resets dirty tracking. Called by canvas bridge after a successful save. */
    clearDirty: () => void;
    /** Replaces all in-memory objects and resets dirty tracking. Used by the canvas bridge for load and reset. */
    setObjects: (objects: Object[]) => void;
}

/** Selector: true when there are unsaved canvas changes. */
export const selectIsDirty = (s: CanvasObjectState): boolean =>
    s.dirtyObjects.length > 0 || s.deletedObjects.length > 0;

export const useCanvasObjectStore = create<CanvasObjectState>()((set, get) => ({
    objects: [],
    dirtyObjects: [],
    deletedObjects: [],

    addObject: (category, points, type) => {
        const envId = useEnvStore.getState().env.id;
        const inMemoryMax = Math.max(0, ...get().objects.filter((o) => o.environmentId === envId).map((o) => o.id));
        const objectId = inMemoryMax + 1;
        set((state) => {
            const newObj: Object = {
                id: objectId,
                environmentId: envId,
                category,
                type,
                vertexCount: 0,
                area: 0,
                vertices: points.map((p) => ({ x: p.x, y: p.y })),
            };
            return commitObject(state, [...state.objects, newObj], objectId);
        });
    },

    deleteObject: (obj) => {
        set((state) => {
            if (!state.objects.some((o) => o.id === obj.id)) return state;
            let dObj = state.dirtyObjects, xObj = state.deletedObjects;
            ({ dirty: dObj, deleted: xObj } = markDeleted(dObj, xObj, obj));
            return {
                objects: state.objects.filter((o) => o.id !== obj.id),
                dirtyObjects: dObj, deletedObjects: xObj,
            };
        });
    },

    moveVertexAt: (ref, pos) =>
        set((state) => ({
            objects: state.objects.map((o) => {
                if (o.id !== ref.objectId) return o;
                const newVerts = o.vertices.map((v, i) => i === ref.index ? { x: pos.x, y: pos.y } : v);
                return { ...o, vertices: newVerts };
            }),
        })),

    finalizeVertexMoveAt: (ref) =>
        set((state) => commitObject(state, state.objects, ref.objectId)),

    moveObject: (obj, dx, dy) =>
        set((state) => {
            const pending = state.objects.map((o) =>
                o.id !== obj.id ? o : { ...o, vertices: o.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) },
            );
            return commitObject(state, pending, obj.id);
        }),

    deleteVertex: (obj, index) =>
        set((state) => {
            const o = state.objects.find((x) => x.id === obj.id);
            if (!o || o.vertices.length <= 3) return state;
            const vertices = o.vertices.filter((_, i) => i !== index);
            return commitObject(state, state.objects.map((x) => x.id === obj.id ? { ...x, vertices } : x), obj.id);
        }),

    deleteVertices: (obj, refs) =>
        set((state) => {
            const o = state.objects.find((x) => x.id === obj.id);
            if (!o) return state;
            const indexSet = new Set(refs.map((r) => r.index));
            if (o.vertices.length - indexSet.size < 3) return state;
            const vertices = o.vertices.filter((_, i) => !indexSet.has(i));
            return commitObject(state, state.objects.map((x) => x.id === obj.id ? { ...x, vertices } : x), obj.id);
        }),

    insertVertex: (objectId, afterIndex, pos) => {
        const newRef: VertexRef = { objectId, index: afterIndex + 1 };
        set((state) => {
            const o = state.objects.find((x) => x.id === objectId);
            if (!o) return state;
            const vertices = [
                ...o.vertices.slice(0, afterIndex + 1),
                { x: pos.x, y: pos.y },
                ...o.vertices.slice(afterIndex + 1),
            ];
            return commitObject(state, state.objects.map((x) => x.id === objectId ? { ...x, vertices } : x), objectId);
        });
        return newRef;
    },

    modifyObjectVertices: (objectId, multiplier, maxRandomOffset) =>
        set((state) => {
            const o = state.objects.find((x) => x.id === objectId);
            if (!o) return state;
            const newVertices = computeModifiedVertices(o.vertices, { multiplier, maxRandomOffset });
            // Same reference means no structural change — skip dirty commit
            if (newVertices === o.vertices) return state;
            return commitObject(
                state,
                state.objects.map((x) => x.id === objectId ? { ...x, vertices: newVertices } : x),
                objectId,
            );
        }),

    updateObjectType: (obj, type) =>
        set((state) => {
            if (!state.objects.some((o) => o.id === obj.id)) return state;
            return commitObject(state, state.objects.map((o) => o.id === obj.id ? { ...o, type } : o), obj.id);
        }),

    updateObjectsType: (type) =>
        set((state) => {
            if (state.objects.length === 0) return state;
            const objects = state.objects.map((o) => ({ ...o, type }));
            let dirtyObjects = state.dirtyObjects;
            let deletedObjects = state.deletedObjects;
            for (const o of objects) {
                ({ dirty: dirtyObjects, deleted: deletedObjects } = markDirty(dirtyObjects, deletedObjects, o));
            }
            return { objects, dirtyObjects, deletedObjects };
        }),

    clearDirty: () =>
        set({
            dirtyObjects: [],
            deletedObjects: [],
        }),

    setObjects: (objects) =>
        set({
            objects: objects.map(normalizeObject),
            dirtyObjects: [],
            deletedObjects: [],
        }),
}));
