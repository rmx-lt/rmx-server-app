import { create } from "zustand";
import { listMaps, type MapListItem } from "@/data/planning/maps";
import { useMapStore } from "@/model/mapStore";
import { saveMapAs } from "@/features/map-manager/data/mapBridge";

interface SaveAsModalState {
    isOpen: boolean;
    maps: MapListItem[];
    name: string;
    /** The name the user typed before picking an overwrite target. Restored on deselect. */
    customName: string;
    /** When set, the save-as will overwrite this existing map instead of creating a new one. */
    selectedMapId: number | null;
    isSaving: boolean;
    open: () => Promise<void>;
    close: () => void;
    setName: (name: string) => void;
    selectMap: (id: number) => void;
    save: () => Promise<void>;
}

export const useSaveAsModalStore = create<SaveAsModalState>((set, get) => ({
    isOpen: false,
    maps: [],
    name: "",
    customName: "",
    selectedMapId: null,
    isSaving: false,

    open: async () => {
        const currentName = useMapStore.getState().map.name;
        const maps = await listMaps().catch((err: unknown) => {
            console.error(err);
            return [];
        });
        set({
            isOpen: true,
            maps,
            name: currentName,
            customName: currentName,
            selectedMapId: null,
            isSaving: false,
        });
    },

    close: () => {
        set({ isOpen: false, maps: [], name: "", customName: "", selectedMapId: null, isSaving: false });
    },

    // Typing always deselects — user is switching to "new map" mode.
    setName: (name) => set({ name, customName: name, selectedMapId: null }),

    selectMap: (id) => {
        set((state) => {
            if (state.selectedMapId === id) {
                // Deselect — restore the last name the user typed.
                return { selectedMapId: null, name: state.customName };
            }
            const map = state.maps.find((e) => e.id === id);
            // Fill name with the selected map's name; keep customName for restore on deselect.
            return { selectedMapId: id, name: map?.name ?? state.name };
        });
    },

    save: async () => {
        if (get().isSaving) return;
        set({ isSaving: true });
        try {
            const { name, selectedMapId } = get();
            await saveMapAs(name, selectedMapId);
        } finally {
            set({ isSaving: false });
        }
        get().close();
    },
}));
