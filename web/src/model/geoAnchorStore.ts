import { create } from "zustand";
import {
    getEnvironmentGeoAnchor,
    initEnvironmentGeoAnchorFromSystem,
    setEnvironmentGeoAnchor as persistEnvironmentGeoAnchor,
} from "@/data/local/environmentGeoAnchor";
import {
    getSystemGeoAnchor,
    setSystemGeoAnchor as persistSystemGeoAnchor,
} from "@/data/local/geoAnchorSystem";
import type { GeoAnchor } from "@/data/local/schemaTypes";
import { getSaveMode } from "@/model/saveModeStore";
import { useEnvStore } from "@/model/envStore";

interface GeoAnchorDraft {
    lat: string;
    lon: string;
}

function toDraft(anchor?: GeoAnchor): GeoAnchorDraft {
    return {
        lat: anchor ? String(anchor.lat) : "",
        lon: anchor ? String(anchor.lon) : "",
    };
}

function isBlankDraft(draft: GeoAnchorDraft): boolean {
    return draft.lat === "" && draft.lon === "";
}

function parseDraft(draft: GeoAnchorDraft): GeoAnchor | undefined {
    if (isBlankDraft(draft)) return undefined;

    const lat = Number.parseFloat(draft.lat);
    const lon = Number.parseFloat(draft.lon);

    if (Number.isNaN(lat) || Number.isNaN(lon)) return undefined;
    if (lat < -90 || lat > 90) return undefined;
    if (lon < -180 || lon > 180) return undefined;

    return { lat, lon };
}

function draftsEqual(a: GeoAnchorDraft, b: GeoAnchorDraft): boolean {
    return a.lat === b.lat && a.lon === b.lon;
}

interface GeoAnchorState {
    systemGeoAnchor?: GeoAnchor;
    environmentGeoAnchor?: GeoAnchor;
    systemDraft: GeoAnchorDraft;
    environmentDraft: GeoAnchorDraft;
    savedSystemDraft: GeoAnchorDraft;
    savedEnvironmentDraft: GeoAnchorDraft;
    isSystemGeoAnchorDirty: boolean;
    isEnvironmentGeoAnchorDirty: boolean;
    loadSystemGeoAnchor: () => Promise<void>;
    loadEnvironmentGeoAnchor: (environmentId: number) => Promise<void>;
    setSystemGeoAnchorDraft: (draft: GeoAnchorDraft) => Promise<void>;
    setEnvironmentGeoAnchorDraft: (environmentId: number, draft: GeoAnchorDraft) => Promise<void>;
    setSystemGeoAnchor: (geoAnchor: GeoAnchor | null) => Promise<void>;
    setEnvironmentGeoAnchor: (environmentId: number, geoAnchor: GeoAnchor | null) => Promise<void>;
    saveGeoAnchors: () => Promise<boolean>;
    clearEnvironmentGeoAnchor: () => void;
}

export const useGeoAnchorStore = create<GeoAnchorState>()((set) => ({
    systemGeoAnchor: undefined,
    environmentGeoAnchor: undefined,
    systemDraft: toDraft(),
    environmentDraft: toDraft(),
    savedSystemDraft: toDraft(),
    savedEnvironmentDraft: toDraft(),
    isSystemGeoAnchorDirty: false,
    isEnvironmentGeoAnchorDirty: false,

    loadSystemGeoAnchor: async () => {
        const geoAnchor = await getSystemGeoAnchor();
        set({
            systemGeoAnchor: geoAnchor,
            systemDraft: toDraft(geoAnchor),
            savedSystemDraft: toDraft(geoAnchor),
            isSystemGeoAnchorDirty: false,
        });
    },

    loadEnvironmentGeoAnchor: async (environmentId: number) => {
        if (environmentId <= 0) {
            set({
                environmentGeoAnchor: undefined,
                environmentDraft: toDraft(),
                savedEnvironmentDraft: toDraft(),
                isEnvironmentGeoAnchorDirty: false,
            });
            return;
        }
        await initEnvironmentGeoAnchorFromSystem(environmentId);
        const geoAnchor = await getEnvironmentGeoAnchor(environmentId);
        set({
            environmentGeoAnchor: geoAnchor,
            environmentDraft: toDraft(geoAnchor),
            savedEnvironmentDraft: toDraft(geoAnchor),
            isEnvironmentGeoAnchorDirty: false,
        });
    },

    setSystemGeoAnchorDraft: async (draft) => {
        const nextGeoAnchor = parseDraft(draft);
        const shouldAutosave = getSaveMode() === "autosave" && (nextGeoAnchor !== undefined || isBlankDraft(draft));

        if (shouldAutosave) {
            await persistSystemGeoAnchor(nextGeoAnchor ?? null);
            set({
                systemGeoAnchor: nextGeoAnchor,
                systemDraft: draft,
                savedSystemDraft: draft,
                isSystemGeoAnchorDirty: false,
            });
            return;
        }

        set((state) => ({
            systemGeoAnchor: nextGeoAnchor,
            systemDraft: draft,
            isSystemGeoAnchorDirty: !draftsEqual(draft, state.savedSystemDraft),
        }));
    },

    setEnvironmentGeoAnchorDraft: async (environmentId, draft) => {
        if (environmentId <= 0) return;

        const nextGeoAnchor = parseDraft(draft);
        const shouldAutosave = getSaveMode() === "autosave" && (nextGeoAnchor !== undefined || isBlankDraft(draft));

        if (shouldAutosave) {
            await persistEnvironmentGeoAnchor(environmentId, nextGeoAnchor ?? null);
            set({
                environmentGeoAnchor: nextGeoAnchor,
                environmentDraft: draft,
                savedEnvironmentDraft: draft,
                isEnvironmentGeoAnchorDirty: false,
            });
            return;
        }

        set((state) => ({
            environmentGeoAnchor: nextGeoAnchor,
            environmentDraft: draft,
            isEnvironmentGeoAnchorDirty: !draftsEqual(draft, state.savedEnvironmentDraft),
        }));
    },

    setSystemGeoAnchor: async (geoAnchor) => {
        await useGeoAnchorStore.getState().setSystemGeoAnchorDraft(toDraft(geoAnchor ?? undefined));
    },

    setEnvironmentGeoAnchor: async (environmentId, geoAnchor) => {
        if (environmentId <= 0) return;
        await useGeoAnchorStore.getState().setEnvironmentGeoAnchorDraft(environmentId, toDraft(geoAnchor ?? undefined));
    },

    saveGeoAnchors: async () => {
        const state = useGeoAnchorStore.getState();
        const systemGeoAnchor = parseDraft(state.systemDraft);
        const environmentGeoAnchor = parseDraft(state.environmentDraft);
        const shouldSaveSystem = state.isSystemGeoAnchorDirty && (systemGeoAnchor !== undefined || isBlankDraft(state.systemDraft));
        const shouldSaveEnvironment = state.isEnvironmentGeoAnchorDirty && (environmentGeoAnchor !== undefined || isBlankDraft(state.environmentDraft));

        if (!shouldSaveSystem && !shouldSaveEnvironment) return false;

        const environmentId = useEnvStore.getState().env.id;

        await Promise.all([
            shouldSaveSystem ? persistSystemGeoAnchor(systemGeoAnchor ?? null) : Promise.resolve(),
            shouldSaveEnvironment
                ? persistEnvironmentGeoAnchor(environmentId, environmentGeoAnchor ?? null)
                : Promise.resolve(),
        ]);

        set({
            systemGeoAnchor,
            systemDraft: state.systemDraft,
            savedSystemDraft: state.systemDraft,
            isSystemGeoAnchorDirty: false,
            environmentGeoAnchor,
            environmentDraft: state.environmentDraft,
            savedEnvironmentDraft: state.environmentDraft,
            isEnvironmentGeoAnchorDirty: false,
        });

        return true;
    },

    clearEnvironmentGeoAnchor: () => {
        set({
            environmentGeoAnchor: undefined,
            environmentDraft: toDraft(),
            savedEnvironmentDraft: toDraft(),
            isEnvironmentGeoAnchorDirty: false,
        });
    },
}));