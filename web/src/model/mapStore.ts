import { create } from "zustand";
import type { MapInfo } from "@/data/planning/schemaTypes";

interface MapState {
    map: MapInfo;
    /** True when map metadata has been changed since the last save or load. */
    isMapDirty: boolean;
    /** Replaces the full map record. Used by map bridge after load or init. Does not mark dirty. */
    setMap: (map: MapInfo) => void;
    /** Updates the map name and marks the record as dirty. Autosave (when on) picks the change up. */
    setName: (name: string) => void;
    /** Clears the dirty flag. Called by canvas bridge after a successful save. */
    clearDirty: () => void;
}

const INITIAL_MAP: MapInfo = {
    id: 0,
    name: "Untitled Map",
    mowingZoneCount: 0,
    noGoZoneCount: 0,
};

function markMapDirty(set: (fn: (state: MapState) => Partial<MapState>) => void, updater: (map: MapInfo) => MapInfo): void {
    set((state) => {
        const map = updater(state.map);
        return { map, isMapDirty: true };
    });
}

export const useMapStore = create<MapState>()((set) => ({
    map: INITIAL_MAP,
    isMapDirty: false,

    setMap: (map) => set({ map }),

    setName: (name) => markMapDirty(set, (map) => ({ ...map, name })),

    clearDirty: () => set({ isMapDirty: false }),
}));
