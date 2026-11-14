import { create } from "zustand";
import type { EnvPoint, EnvPointType } from "@/data/planning/schemaTypes";

// The route points (start, end, or one combined start/end point) of the open
// map. They are saved with the map; changes only mark the store dirty.

interface EnvPointState {
    startPoint: EnvPoint | null;
    endPoint: EnvPoint | null;
    startEndPoint: EnvPoint | null;
    isEnvPointsDirty: boolean;
    movePointLive: (environmentId: number, type: EnvPointType, point: { x: number; y: number }) => void;
    /** Replaces the points with a loaded map's (not dirty). */
    setPoints: (points: EnvPoint[]) => void;
    upsertPoint: (environmentId: number, type: EnvPointType, point: { x: number; y: number }) => Promise<void>;
    deletePoint: (environmentId: number, type: EnvPointType) => Promise<void>;
    changePointType: (environmentId: number, fromType: EnvPointType, toType: EnvPointType) => Promise<void>;
    clearDirty: () => void;
    clearPoints: () => void;
}

/** Placing a point: start_end replaces start and end, and start or end replaces start_end. */
function placed(type: EnvPointType, updated: EnvPoint): Partial<EnvPointState> {
    if (type === "start") return { startPoint: updated, startEndPoint: null, isEnvPointsDirty: true };
    if (type === "end") return { endPoint: updated, startEndPoint: null, isEnvPointsDirty: true };
    return { startPoint: null, endPoint: null, startEndPoint: updated, isEnvPointsDirty: true };
}

/** All points of the store, as a map document holds them. */
export function getEnvPoints(state: Pick<EnvPointState, "startPoint" | "endPoint" | "startEndPoint">): EnvPoint[] {
    return [state.startPoint, state.endPoint, state.startEndPoint].filter((p): p is EnvPoint => p !== null);
}

export const useEnvPointStore = create<EnvPointState>((set) => ({
    startPoint: null,
    endPoint: null,
    startEndPoint: null,
    isEnvPointsDirty: false,

    movePointLive: (environmentId, type, point) => {
        set(placed(type, { environmentId, type, point }));
    },

    setPoints: (points) => {
        set({
            startPoint: points.find((p) => p.type === "start") ?? null,
            endPoint: points.find((p) => p.type === "end") ?? null,
            startEndPoint: points.find((p) => p.type === "start_end") ?? null,
            isEnvPointsDirty: false,
        });
    },

    upsertPoint: async (environmentId, type, point) => {
        set(placed(type, { environmentId, type, point }));
    },

    deletePoint: async (_environmentId, type) => {
        if (type === "start") set({ startPoint: null, isEnvPointsDirty: true });
        else if (type === "end") set({ endPoint: null, isEnvPointsDirty: true });
        else set({ startEndPoint: null, isEnvPointsDirty: true });
    },

    changePointType: async (environmentId, fromType, toType) => {
        const state = useEnvPointStore.getState();
        let coords: { x: number; y: number } | undefined;
        if (fromType === "start") coords = state.startPoint?.point;
        else if (fromType === "end") coords = state.endPoint?.point;
        else coords = state.startEndPoint?.point;
        if (!coords) return;
        // Only the target type remains.
        const updated: EnvPoint = { environmentId, type: toType, point: coords };
        set({
            startPoint: toType === "start" ? updated : null,
            endPoint: toType === "end" ? updated : null,
            startEndPoint: toType === "start_end" ? updated : null,
            isEnvPointsDirty: true,
        });
    },

    clearDirty: () => set({ isEnvPointsDirty: false }),

    clearPoints: () => {
        set({ startPoint: null, endPoint: null, startEndPoint: null, isEnvPointsDirty: false });
    },
}));
