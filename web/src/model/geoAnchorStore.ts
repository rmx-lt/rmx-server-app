import { create } from "zustand";
import { getDefaultGeoAnchor, setDefaultGeoAnchor } from "@/data/planning/geoAnchorDefault";
import type { GeoAnchor } from "@/data/planning/schemaTypes";
import { getSaveMode } from "@/model/saveModeStore";

// Two geo anchors: the user's default ("system", a per-user setting on the
// server, used for new maps) and the open map's ("environment", saved with
// the map). The fields are edited as text drafts; a draft that doesn't parse
// leaves the anchor unchanged.

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

/** A draft that is blank or a valid anchor (one that can be saved). */
function isSavable(draft: GeoAnchorDraft): boolean {
    return parseDraft(draft) !== undefined || isBlankDraft(draft);
}

/**
 * The open map's anchor to save: the draft when it is blank or valid, else
 * the anchor last saved (a half-typed coordinate is not saved).
 */
export function getSavableEnvironmentGeoAnchor(state: Pick<GeoAnchorState, "environmentDraft" | "savedEnvironmentDraft">): GeoAnchor | undefined {
    return isSavable(state.environmentDraft) ? parseDraft(state.environmentDraft) : parseDraft(state.savedEnvironmentDraft);
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
    /** Reads the user's default anchor from the server. */
    loadSystemGeoAnchor: () => Promise<void>;
    /** Sets the open map's anchor as loaded or created (not dirty). */
    setLoadedEnvironmentGeoAnchor: (geoAnchor: GeoAnchor | undefined) => void;
    setSystemGeoAnchorDraft: (draft: GeoAnchorDraft) => Promise<void>;
    setEnvironmentGeoAnchorDraft: (environmentId: number, draft: GeoAnchorDraft) => Promise<void>;
    setSystemGeoAnchor: (geoAnchor: GeoAnchor | null) => Promise<void>;
    setEnvironmentGeoAnchor: (environmentId: number, geoAnchor: GeoAnchor | null) => Promise<void>;
    /**
     * Called after the map was saved: stores the default anchor if it changed,
     * and marks both anchors saved. Returns whether anything was dirty.
     */
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
        const geoAnchor = await getDefaultGeoAnchor();
        set({
            systemGeoAnchor: geoAnchor,
            systemDraft: toDraft(geoAnchor),
            savedSystemDraft: toDraft(geoAnchor),
            isSystemGeoAnchorDirty: false,
        });
    },

    setLoadedEnvironmentGeoAnchor: (geoAnchor) => {
        set({
            environmentGeoAnchor: geoAnchor,
            environmentDraft: toDraft(geoAnchor),
            savedEnvironmentDraft: toDraft(geoAnchor),
            isEnvironmentGeoAnchorDirty: false,
        });
    },

    setSystemGeoAnchorDraft: async (draft) => {
        const nextGeoAnchor = parseDraft(draft);

        // The default is the user's setting, not part of the map: with
        // autosave on it is stored at once.
        if (getSaveMode() === "autosave" && isSavable(draft)) {
            await setDefaultGeoAnchor(nextGeoAnchor ?? null);
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

    setEnvironmentGeoAnchorDraft: async (_environmentId, draft) => {
        // Part of the map: marked dirty, saved with the map (autosave picks it up).
        set((state) => ({
            environmentGeoAnchor: parseDraft(draft),
            environmentDraft: draft,
            isEnvironmentGeoAnchorDirty: !draftsEqual(draft, state.savedEnvironmentDraft),
        }));
    },

    setSystemGeoAnchor: async (geoAnchor) => {
        await useGeoAnchorStore.getState().setSystemGeoAnchorDraft(toDraft(geoAnchor ?? undefined));
    },

    setEnvironmentGeoAnchor: async (environmentId, geoAnchor) => {
        await useGeoAnchorStore.getState().setEnvironmentGeoAnchorDraft(environmentId, toDraft(geoAnchor ?? undefined));
    },

    saveGeoAnchors: async () => {
        const state = useGeoAnchorStore.getState();
        const shouldSaveSystem = state.isSystemGeoAnchorDirty && isSavable(state.systemDraft);
        const environmentSaved = state.isEnvironmentGeoAnchorDirty && isSavable(state.environmentDraft);

        if (!shouldSaveSystem && !environmentSaved) return false;

        if (shouldSaveSystem) await setDefaultGeoAnchor(parseDraft(state.systemDraft) ?? null);

        set({
            ...(shouldSaveSystem && {
                systemGeoAnchor: parseDraft(state.systemDraft),
                savedSystemDraft: state.systemDraft,
                isSystemGeoAnchorDirty: false,
            }),
            ...(environmentSaved && {
                environmentGeoAnchor: parseDraft(state.environmentDraft),
                savedEnvironmentDraft: state.environmentDraft,
                isEnvironmentGeoAnchorDirty: false,
            }),
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
