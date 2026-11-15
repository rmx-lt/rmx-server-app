import { create } from "zustand";
import type { Zone } from "@/data/planning/schemaTypes";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { type ZoneCategory } from "@/config/db-ops/enums";
import { useMapStore } from "@/model/mapStore";
import { syncObject, normalizeObject, markDirty, markDeleted } from "@/features/canvas-editing/utils/canvasObjectUtils";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

type MutationState = Pick<CanvasObjectState, "objects" | "dirtyObjects" | "deletedObjects">;

/**
 * Applies syncObject (winding + stats) to the object at objectId, marks it dirty,
 * and returns the updated slice of store state. Used by every mutation that modifies vertices.
 */
function commitObject(state: MutationState, pending: Zone[], objectId: number): MutationState {
    const objects = syncObject(pending, objectId);
    const obj = objects.find((o) => o.id === objectId)!;
    const { dirty: dirtyObjects, deleted: deletedObjects } = markDirty(state.dirtyObjects, state.deletedObjects, obj);
    return { objects, dirtyObjects, deletedObjects };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface CanvasObjectState {
    objects: Zone[];

    dirtyObjects: Zone[];
    deletedObjects: Zone[];

    /** Adds a new polygon object with the given vertices. Marks object dirty. */
    addObject: (category: ZoneCategory, points: Point[]) => void;
    /** Removes an object. Marks it as deleted. */
    deleteObject: (obj: Zone) => void;
    /** Updates x,y of a single vertex during drag — no sync, no dirty tracking. Call finalizeVertexMoveAt on drag end. */
    moveVertexAt: (ref: VertexRef, pos: Point) => void;
    /** Runs syncObject + marks dirty once after a vertex drag completes. */
    finalizeVertexMoveAt: (ref: VertexRef) => void;
    /** Translates all vertices of an object by (dx, dy). Marks object dirty. */
    moveObject: (obj: Zone, dx: number, dy: number) => void;
    /** Removes a vertex by index from an object. No-op when the object has ≤ 3 vertices. */
    deleteVertex: (obj: Zone, index: number) => void;
    /** Removes multiple vertices by VertexRef. No-op when the result would have fewer than 3 vertices. */
    deleteVertices: (obj: Zone, refs: VertexRef[]) => void;
    /** Inserts a new vertex after afterIndex. Returns the VertexRef for the new vertex. */
    insertVertex: (objectId: number, afterIndex: number, pos: Point) => VertexRef;
    /** Replaces all in-memory objects and resets dirty tracking. Used by the canvas bridge for load and reset. */
    setObjects: (objects: Zone[]) => void;
}

export const useCanvasObjectStore = create<CanvasObjectState>()((set, get) => ({
    objects: [],
    dirtyObjects: [],
    deletedObjects: [],

    addObject: (category, points) => {
        const mapId = useMapStore.getState().map.id;
        // All objects in memory belong to the open map (its id changes on the first save).
        const inMemoryMax = Math.max(0, ...get().objects.map((o) => o.id));
        const objectId = inMemoryMax + 1;
        set((state) => {
            const newObj: Zone = {
                id: objectId,
                mapId: mapId,
                category,
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

    setObjects: (objects) =>
        set({
            objects: objects.map(normalizeObject),
            dirtyObjects: [],
            deletedObjects: [],
        }),
}));
