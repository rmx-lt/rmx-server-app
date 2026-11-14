import { create } from "zustand";
import { getDefaultGeoAnchor, setDefaultGeoAnchor } from "@/data/planning/geoAnchorDefault";
import type { GeoAnchor } from "@/data/planning/schemaTypes";
import { getSaveMode } from "@/model/saveModeStore";

// Two geo anchors: the user's default ("system", a per-user setting on the
// server, used for new maps) and the open map's ("map", saved with
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
export function getSavableMapGeoAnchor(state: Pick<GeoAnchorState, "mapDraft" | "savedMapDraft">): GeoAnchor | undefined {
    return isSavable(state.mapDraft) ? parseDraft(state.mapDraft) : parseDraft(state.savedMapDraft);
}

interface GeoAnchorState {
    systemGeoAnchor?: GeoAnchor;
    mapGeoAnchor?: GeoAnchor;
    systemDraft: GeoAnchorDraft;
    mapDraft: GeoAnchorDraft;
    savedSystemDraft: GeoAnchorDraft;
    savedMapDraft: GeoAnchorDraft;
    isSystemGeoAnchorDirty: boolean;
    isMapGeoAnchorDirty: boolean;
    /** Reads the user's default anchor from the server. */
    loadSystemGeoAnchor: () => Promise<void>;
    /** Sets the open map's anchor as loaded or created (not dirty). */
    setLoadedMapGeoAnchor: (geoAnchor: GeoAnchor | undefined) => void;
    setSystemGeoAnchorDraft: (draft: GeoAnchorDraft) => Promise<void>;
    setMapGeoAnchorDraft: (mapId: number, draft: GeoAnchorDraft) => Promise<void>;
    setSystemGeoAnchor: (geoAnchor: GeoAnchor | null) => Promise<void>;
    setMapGeoAnchor: (mapId: number, geoAnchor: GeoAnchor | null) => Promise<void>;
    /**
     * Called after the map was saved: stores the default anchor if it changed,
     * and marks both anchors saved. Returns whether anything was dirty.
     */
    saveGeoAnchors: () => Promise<boolean>;
    clearMapGeoAnchor: () => void;
}

export const useGeoAnchorStore = create<GeoAnchorState>()((set) => ({
    systemGeoAnchor: undefined,
    mapGeoAnchor: undefined,
    systemDraft: toDraft(),
    mapDraft: toDraft(),
    savedSystemDraft: toDraft(),
    savedMapDraft: toDraft(),
    isSystemGeoAnchorDirty: false,
    isMapGeoAnchorDirty: false,

    loadSystemGeoAnchor: async () => {
        const geoAnchor = await getDefaultGeoAnchor();
        set({
            systemGeoAnchor: geoAnchor,
            systemDraft: toDraft(geoAnchor),
            savedSystemDraft: toDraft(geoAnchor),
            isSystemGeoAnchorDirty: false,
        });
    },

    setLoadedMapGeoAnchor: (geoAnchor) => {
        set({
            mapGeoAnchor: geoAnchor,
            mapDraft: toDraft(geoAnchor),
            savedMapDraft: toDraft(geoAnchor),
            isMapGeoAnchorDirty: false,
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

    setMapGeoAnchorDraft: async (_mapId, draft) => {
        // Part of the map: marked dirty, saved with the map (autosave picks it up).
        set((state) => ({
            mapGeoAnchor: parseDraft(draft),
            mapDraft: draft,
            isMapGeoAnchorDirty: !draftsEqual(draft, state.savedMapDraft),
        }));
    },

    setSystemGeoAnchor: async (geoAnchor) => {
        await useGeoAnchorStore.getState().setSystemGeoAnchorDraft(toDraft(geoAnchor ?? undefined));
    },

    setMapGeoAnchor: async (mapId, geoAnchor) => {
        await useGeoAnchorStore.getState().setMapGeoAnchorDraft(mapId, toDraft(geoAnchor ?? undefined));
    },

    saveGeoAnchors: async () => {
        const state = useGeoAnchorStore.getState();
        const shouldSaveSystem = state.isSystemGeoAnchorDirty && isSavable(state.systemDraft);
        const mapSaved = state.isMapGeoAnchorDirty && isSavable(state.mapDraft);

        if (!shouldSaveSystem && !mapSaved) return false;

        if (shouldSaveSystem) await setDefaultGeoAnchor(parseDraft(state.systemDraft) ?? null);

        set({
            ...(shouldSaveSystem && {
                systemGeoAnchor: parseDraft(state.systemDraft),
                savedSystemDraft: state.systemDraft,
                isSystemGeoAnchorDirty: false,
            }),
            ...(mapSaved && {
                mapGeoAnchor: parseDraft(state.mapDraft),
                savedMapDraft: state.mapDraft,
                isMapGeoAnchorDirty: false,
            }),
        });

        return true;
    },

    clearMapGeoAnchor: () => {
        set({
            mapGeoAnchor: undefined,
            mapDraft: toDraft(),
            savedMapDraft: toDraft(),
            isMapGeoAnchorDirty: false,
        });
    },
}));
