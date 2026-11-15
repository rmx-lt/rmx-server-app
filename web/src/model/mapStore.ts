import { create } from "zustand";
import type { MapInfo } from "@/data/planning/schemaTypes";

interface MapState {
    map: MapInfo;
    /** Replaces the full map record. Used by map bridge after load or init. Does not mark dirty. */
    setMap: (map: MapInfo) => void;
    /** Updates the map name. The autosave (useCanvasAutosave) picks the change up. */
    setName: (name: string) => void;
}

const INITIAL_MAP: MapInfo = {
    id: 0,
    name: "Untitled Map",
    mowingZoneCount: 0,
    noGoZoneCount: 0,
};

export const useMapStore = create<MapState>()((set) => ({
    map: INITIAL_MAP,

    setMap: (map) => set({ map }),

    setName: (name) => set((state) => ({ map: { ...state.map, name } })),
}));
