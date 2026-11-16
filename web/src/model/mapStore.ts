import { create } from "zustand";
import { ZONE_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import type { MapInfo, Zone } from "@/data/planning/schemaTypes";

interface MapState {
    map: MapInfo;
    /** The zones of the open map. */
    zones: Zone[];
    /** The zone the canvas shows and drawing adds to. */
    activeZoneId: number;
    /** Replaces the full map record. Used by map bridge after load or init. Does not mark dirty. */
    setMap: (map: MapInfo, zones: Zone[], activeZoneId: number) => void;
    /** Updates the map name. The autosave (useCanvasAutosave) picks the change up. */
    setName: (name: string) => void;
    /** Renames a zone (an empty name changes nothing). The autosave picks the change up. */
    renameZone: (id: number, name: string) => void;
}

/** The zone a new map starts with. */
export const FIRST_ZONE: Zone = { id: 1, name: "Zone 1" };

const INITIAL_MAP: MapInfo = {
    id: 0,
    name: "Untitled Map",
    mowingAreaCount: 0,
    noGoAreaCount: 0,
};

export const useMapStore = create<MapState>()((set) => ({
    map: INITIAL_MAP,
    zones: [FIRST_ZONE],
    activeZoneId: FIRST_ZONE.id,

    setMap: (map, zones, activeZoneId) => set({ map, zones, activeZoneId }),

    setName: (name) => set((state) => ({ map: { ...state.map, name } })),

    renameZone: (id, name) => {
        const trimmed = name.trim().slice(0, ZONE_NAME_MAX_LENGTH);
        if (!trimmed) return;
        set((state) => ({ zones: state.zones.map((z) => (z.id === id ? { ...z, name: trimmed } : z)) }));
    },
}));
