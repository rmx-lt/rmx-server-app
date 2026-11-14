import { create } from "zustand";
import type { MapPoint, MapPointType } from "@/data/planning/schemaTypes";

// The route points (start, end, or one combined start/end point) of the open
// map. They are saved with the map; changes only mark the store dirty.

interface MapPointState {
    startPoint: MapPoint | null;
    endPoint: MapPoint | null;
    startEndPoint: MapPoint | null;
    isMapPointsDirty: boolean;
    movePointLive: (mapId: number, type: MapPointType, point: { x: number; y: number }) => void;
    /** Replaces the points with a loaded map's (not dirty). */
    setPoints: (points: MapPoint[]) => void;
    upsertPoint: (mapId: number, type: MapPointType, point: { x: number; y: number }) => Promise<void>;
    deletePoint: (mapId: number, type: MapPointType) => Promise<void>;
    changePointType: (mapId: number, fromType: MapPointType, toType: MapPointType) => Promise<void>;
    clearDirty: () => void;
    clearPoints: () => void;
}

/** Placing a point: start_end replaces start and end, and start or end replaces start_end. */
function placed(type: MapPointType, updated: MapPoint): Partial<MapPointState> {
    if (type === "start") return { startPoint: updated, startEndPoint: null, isMapPointsDirty: true };
    if (type === "end") return { endPoint: updated, startEndPoint: null, isMapPointsDirty: true };
    return { startPoint: null, endPoint: null, startEndPoint: updated, isMapPointsDirty: true };
}

/** All points of the store, as a map document holds them. */
export function getMapPoints(state: Pick<MapPointState, "startPoint" | "endPoint" | "startEndPoint">): MapPoint[] {
    return [state.startPoint, state.endPoint, state.startEndPoint].filter((p): p is MapPoint => p !== null);
}

export const useMapPointStore = create<MapPointState>((set) => ({
    startPoint: null,
    endPoint: null,
    startEndPoint: null,
    isMapPointsDirty: false,

    movePointLive: (mapId, type, point) => {
        set(placed(type, { mapId, type, point }));
    },

    setPoints: (points) => {
        set({
            startPoint: points.find((p) => p.type === "start") ?? null,
            endPoint: points.find((p) => p.type === "end") ?? null,
            startEndPoint: points.find((p) => p.type === "start_end") ?? null,
            isMapPointsDirty: false,
        });
    },

    upsertPoint: async (mapId, type, point) => {
        set(placed(type, { mapId, type, point }));
    },

    deletePoint: async (_mapId, type) => {
        if (type === "start") set({ startPoint: null, isMapPointsDirty: true });
        else if (type === "end") set({ endPoint: null, isMapPointsDirty: true });
        else set({ startEndPoint: null, isMapPointsDirty: true });
    },

    changePointType: async (mapId, fromType, toType) => {
        const state = useMapPointStore.getState();
        let coords: { x: number; y: number } | undefined;
        if (fromType === "start") coords = state.startPoint?.point;
        else if (fromType === "end") coords = state.endPoint?.point;
        else coords = state.startEndPoint?.point;
        if (!coords) return;
        // Only the target type remains.
        const updated: MapPoint = { mapId, type: toType, point: coords };
        set({
            startPoint: toType === "start" ? updated : null,
            endPoint: toType === "end" ? updated : null,
            startEndPoint: toType === "start_end" ? updated : null,
            isMapPointsDirty: true,
        });
    },

    clearDirty: () => set({ isMapPointsDirty: false }),

    clearPoints: () => {
        set({ startPoint: null, endPoint: null, startEndPoint: null, isMapPointsDirty: false });
    },
}));
