import { create } from "zustand";
import { COORD_SYSTEM, MAP_FORMAT, MAP_TYPE, type CoordSystemType, type MapFormat, type MapType } from "@/config/db-ops/enums";
import type { MapInfo } from "@/data/planning/schemaTypes";

/** Fills in fields that maps saved by earlier versions may lack. */
function normalizeMap(map: MapInfo): MapInfo {
    const maybeHeadland = map as MapInfo & { headlandEnabled?: boolean; headlandWidth?: string };
    return {
        ...map,
        coordSystem: (map as MapInfo & { coordSystem?: string }).coordSystem ?? COORD_SYSTEM.CARTESIAN,
        headlandEnabled: maybeHeadland.headlandEnabled ?? true,
        headlandWidth: maybeHeadland.headlandWidth ?? "10",
    };
}

interface MapState {
    map: MapInfo;
    /** True when map metadata has been changed since the last save or load. */
    isMapDirty: boolean;
    /** Replaces the full map record. Used by map bridge after load or init. Does not mark dirty. */
    setMap: (map: MapInfo) => void;
    /** Updates the map name and marks the record as dirty. Autosave (when on) picks the change up. */
    setName: (name: string) => void;
    /** Updates the map format and marks the record as dirty. Autosave (when on) picks the change up. */
    setFormat: (format: MapFormat) => void;
    /** Updates the map type and marks the record as dirty. Autosave (when on) picks the change up. */
    setType: (type: MapType) => void;
    /** Updates the map coordinate system and marks the record as dirty. Autosave (when on) picks the change up. */
    setCoordSystem: (coordSystem: CoordSystemType) => void;
    /** Updates system headland enabled flag on the map and marks dirty. */
    setHeadlandEnabled: (enabled: boolean) => void;
    /** Updates system headland width on the map and marks dirty. */
    setHeadlandWidth: (width: string) => void;
    /** Clears the dirty flag. Called by canvas bridge after a successful save. */
    clearDirty: () => void;
}

const INITIAL_MAP: MapInfo = {
    id: 0,
    name: "Untitled Map",
    format: MAP_FORMAT.POLYGON,
    type: MAP_TYPE.ANY_OFFLINE,
    coordSystem: COORD_SYSTEM.CARTESIAN,
    headlandEnabled: true,
    headlandWidth: "10",
    mowingZoneCount: 0,
    noGoZoneCount: 0,
};

function markMapDirty(set: (fn: (state: MapState) => Partial<MapState>) => void, updater: (map: MapInfo) => MapInfo): void {
    set((state) => {
        const map = updater(normalizeMap(state.map));
        return { map, isMapDirty: true };
    });
}

export const useMapStore = create<MapState>()((set) => ({
    map: INITIAL_MAP,
    isMapDirty: false,

    setMap: (map) => set({ map: normalizeMap(map) }),

    setName: (name) => markMapDirty(set, (map) => ({ ...map, name })),

    setFormat: (format) => markMapDirty(set, (map) => ({ ...map, format })),

    setType: (type) => markMapDirty(set, (map) => ({ ...map, type })),

    setCoordSystem: (coordSystem) => markMapDirty(set, (map) => ({ ...map, coordSystem })),

    setHeadlandEnabled: (enabled) => markMapDirty(set, (map) => ({ ...map, headlandEnabled: enabled })),

    setHeadlandWidth: (width) => markMapDirty(set, (map) => ({ ...map, headlandWidth: width })),

    clearDirty: () => set({ isMapDirty: false }),
}));
