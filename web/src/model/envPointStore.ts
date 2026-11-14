import { create } from "zustand";
import { getEnvPoints, upsertEnvPoint, deleteEnvPoint } from "@/data/local/envPoints";
import type { EnvPoint, EnvPointType } from "@/data/local/schemaTypes";

interface EnvPointState {
    startPoint: EnvPoint | null;
    endPoint: EnvPoint | null;
    startEndPoint: EnvPoint | null;
    isEnvPointsDirty: boolean;
    movePointLive: (environmentId: number, type: EnvPointType, point: { x: number; y: number }) => void;
    loadEnvPoints: (environmentId: number) => Promise<void>;
    upsertPoint: (environmentId: number, type: EnvPointType, point: { x: number; y: number }) => Promise<void>;
    deletePoint: (environmentId: number, type: EnvPointType) => Promise<void>;
    changePointType: (environmentId: number, fromType: EnvPointType, toType: EnvPointType) => Promise<void>;
    clearDirty: () => void;
    clearPoints: () => void;
}

export const useEnvPointStore = create<EnvPointState>((set) => ({
    startPoint: null,
    endPoint: null,
    startEndPoint: null,
    isEnvPointsDirty: false,

    movePointLive: (environmentId: number, type: EnvPointType, point: { x: number; y: number }) => {
        const updated: EnvPoint = { environmentId, type, point };
        if (type === "start") {
            set({ startPoint: updated, startEndPoint: null, isEnvPointsDirty: true });
        } else if (type === "end") {
            set({ endPoint: updated, startEndPoint: null, isEnvPointsDirty: true });
        } else {
            set({ startPoint: null, endPoint: null, startEndPoint: updated, isEnvPointsDirty: true });
        }
    },

    loadEnvPoints: async (environmentId: number) => {
        const points = await getEnvPoints(environmentId);
        set({
            startPoint: points.find((p) => p.type === "start") ?? null,
            endPoint: points.find((p) => p.type === "end") ?? null,
            startEndPoint: points.find((p) => p.type === "start_end") ?? null,
        });
    },

    upsertPoint: async (environmentId: number, type: EnvPointType, point: { x: number; y: number }) => {
        if (type === "start_end") {
            // start_end is exclusive: remove separate start/end first
            await deleteEnvPoint(environmentId, "start");
            await deleteEnvPoint(environmentId, "end");
        } else {
            // placing a separate start or end clears any existing start_end
            await deleteEnvPoint(environmentId, "start_end");
        }
        await upsertEnvPoint(environmentId, type, point);
        const updated: EnvPoint = { environmentId, type, point };
        if (type === "start") {
            set({ startPoint: updated, startEndPoint: null, isEnvPointsDirty: true });
        } else if (type === "end") {
            set({ endPoint: updated, startEndPoint: null, isEnvPointsDirty: true });
        } else {
            set({ startPoint: null, endPoint: null, startEndPoint: updated, isEnvPointsDirty: true });
        }
    },

    deletePoint: async (environmentId: number, type: EnvPointType) => {
        await deleteEnvPoint(environmentId, type);
        if (type === "start") {
            set({ startPoint: null, isEnvPointsDirty: true });
        } else if (type === "end") {
            set({ endPoint: null, isEnvPointsDirty: true });
        } else {
            set({ startEndPoint: null, isEnvPointsDirty: true });
        }
    },

    changePointType: async (environmentId: number, fromType: EnvPointType, toType: EnvPointType) => {
        const state = useEnvPointStore.getState();
        let coords: { x: number; y: number } | undefined;
        if (fromType === "start") coords = state.startPoint?.point;
        else if (fromType === "end") coords = state.endPoint?.point;
        else coords = state.startEndPoint?.point;
        if (!coords) return;
        // Delete all types to guarantee only the target type remains
        await deleteEnvPoint(environmentId, "start");
        await deleteEnvPoint(environmentId, "end");
        await deleteEnvPoint(environmentId, "start_end");
        await upsertEnvPoint(environmentId, toType, coords);
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
        set({ startPoint: null, endPoint: null, startEndPoint: null });
    },
}));
