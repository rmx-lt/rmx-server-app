import { create } from "zustand";
import { getDefaultGeoAnchor, setDefaultGeoAnchor } from "@/data/planning/geoAnchorDefault";
import type { GeoAnchor } from "@/data/planning/schemaTypes";

// Two geo anchors: the user's default ("system", a per-user setting on the
// server, used for new maps; stored at once) and the open map's ("map",
// saved with the map by the autosave). The fields are edited as text drafts;
// a draft that doesn't parse leaves the anchor unchanged.

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

/** A draft that is blank or a valid anchor (one that can be saved). */
function isSavable(draft: GeoAnchorDraft): boolean {
    return parseDraft(draft) !== undefined || isBlankDraft(draft);
}

interface GeoAnchorState {
    systemGeoAnchor?: GeoAnchor;
    mapGeoAnchor?: GeoAnchor;
    systemDraft: GeoAnchorDraft;
    mapDraft: GeoAnchorDraft;
    /** Reads the user's default anchor from the server. */
    loadSystemGeoAnchor: () => Promise<void>;
    /** Sets the open map's anchor as loaded or created (not dirty). */
    setLoadedMapGeoAnchor: (geoAnchor: GeoAnchor | undefined) => void;
    setSystemGeoAnchorDraft: (draft: GeoAnchorDraft) => Promise<void>;
    setMapGeoAnchorDraft: (mapId: number, draft: GeoAnchorDraft) => Promise<void>;
    setSystemGeoAnchor: (geoAnchor: GeoAnchor | null) => Promise<void>;
    setMapGeoAnchor: (mapId: number, geoAnchor: GeoAnchor | null) => Promise<void>;
    clearMapGeoAnchor: () => void;
}

export const useGeoAnchorStore = create<GeoAnchorState>()((set) => ({
    systemGeoAnchor: undefined,
    mapGeoAnchor: undefined,
    systemDraft: toDraft(),
    mapDraft: toDraft(),

    loadSystemGeoAnchor: async () => {
        const geoAnchor = await getDefaultGeoAnchor();
        set({
            systemGeoAnchor: geoAnchor,
            systemDraft: toDraft(geoAnchor),
        });
    },

    setLoadedMapGeoAnchor: (geoAnchor) => {
        set({
            mapGeoAnchor: geoAnchor,
            mapDraft: toDraft(geoAnchor),
        });
    },

    setSystemGeoAnchorDraft: async (draft) => {
        if (!isSavable(draft)) {
            set({ systemDraft: draft });
            return;
        }
        const geoAnchor = parseDraft(draft);
        set({ systemGeoAnchor: geoAnchor, systemDraft: draft });
        // The default is the user's setting, not part of the map: stored at once.
        await setDefaultGeoAnchor(geoAnchor ?? null).catch(console.error);
    },

    setMapGeoAnchorDraft: async (_mapId, draft) => {
        // Part of the map: the autosave saves it (it watches mapGeoAnchor).
        set((state) => ({ mapDraft: draft, mapGeoAnchor: isSavable(draft) ? parseDraft(draft) : state.mapGeoAnchor }));
    },

    setSystemGeoAnchor: async (geoAnchor) => {
        await useGeoAnchorStore.getState().setSystemGeoAnchorDraft(toDraft(geoAnchor ?? undefined));
    },

    setMapGeoAnchor: async (mapId, geoAnchor) => {
        await useGeoAnchorStore.getState().setMapGeoAnchorDraft(mapId, toDraft(geoAnchor ?? undefined));
    },

    clearMapGeoAnchor: () => {
        set({
            mapGeoAnchor: undefined,
            mapDraft: toDraft(),
        });
    },
}));
