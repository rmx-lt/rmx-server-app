import { create } from "zustand";
import { getUiPreference, setUiPreference } from "@/data/planning/uiPreferences";

export type MapLayer = "satellite" | "street" | "empty";

const KEY = "map.layer";

interface MapLayerState {
    layer: MapLayer;
    /** Reads the user's choice from the server (once per page load). */
    load: () => Promise<void>;
    /** The Layers button: satellite and empty swap; from the street map it goes to satellite. */
    toggle: () => void;
    set: (layer: MapLayer) => void;
}

let loaded = false;

export const useMapLayerStore = create<MapLayerState>()((set, get) => ({
    layer: "satellite",
    load: async () => {
        if (loaded) return;
        loaded = true;
        const saved = await getUiPreference<unknown>(KEY, "satellite");
        // Anything else (an old or unknown value) means satellite.
        set({ layer: saved === "street" || saved === "empty" ? saved : "satellite" });
    },
    toggle: () => get().set(get().layer === "satellite" ? "empty" : "satellite"),
    set: (layer) => {
        set({ layer });
        void setUiPreference(KEY, layer);
    },
}));
