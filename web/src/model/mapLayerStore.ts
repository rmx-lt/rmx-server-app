import { create } from "zustand";
import { getUiPreference, setUiPreference } from "@/data/planning/uiPreferences";

export type MapLayer = "satellite" | "street";

const KEY = "map.layer";

interface MapLayerState {
    layer: MapLayer;
    /** Reads the user's choice from the server (once per page load). */
    load: () => Promise<void>;
    toggle: () => void;
}

let loaded = false;

export const useMapLayerStore = create<MapLayerState>()((set, get) => ({
    layer: "satellite",
    load: async () => {
        if (loaded) return;
        loaded = true;
        const saved = await getUiPreference<unknown>(KEY, "satellite");
        set({ layer: saved === "street" ? "street" : "satellite" });
    },
    toggle: () => {
        const layer: MapLayer = get().layer === "satellite" ? "street" : "satellite";
        set({ layer });
        void setUiPreference(KEY, layer);
    },
}));
