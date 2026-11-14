import { create } from "zustand";
import type { ImportedMapData } from "@/features/map-manager/utils/importMapXml";
import { importMap } from "@/features/map-manager/data/mapBridge";

interface ImportModalState {
    isOpen: boolean;
    name: string;
    preview: ImportedMapData | null;
    isImporting: boolean;
    open: (data: ImportedMapData) => void;
    setName: (name: string) => void;
    confirm: () => Promise<void>;
    close: () => void;
}

export const useImportModalStore = create<ImportModalState>()((set, get) => ({
    isOpen: false,
    name: "",
    preview: null,
    isImporting: false,

    open: (data) => {
        set({ isOpen: true, name: data.name, preview: data, isImporting: false });
    },

    setName: (name) => set({ name }),

    confirm: async () => {
        const { preview, name, isImporting } = get();
        if (!preview || isImporting) return;
        set({ isImporting: true });
        try {
            await importMap({ ...preview, name });
        } finally {
            set({ isImporting: false });
        }
        get().close();
    },

    close: () => set({ isOpen: false, name: "", preview: null, isImporting: false }),
}));
