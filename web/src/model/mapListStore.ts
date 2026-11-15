import { create } from "zustand";
import { listMaps, type MapListItem } from "@/data/planning/maps";

/** The user's maps, newest change first, as the side panel lists them. */
export const useMapListStore = create<{
    items: MapListItem[];
    /** Reads the list from the server (a failure keeps the old list). */
    refresh: () => Promise<void>;
}>()((set) => ({
    items: [],
    refresh: async () => {
        try {
            set({ items: await listMaps() });
        } catch (err) {
            console.error("reading the map list failed", err);
        }
    },
}));
