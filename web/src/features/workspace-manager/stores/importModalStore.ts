import { create } from "zustand";
import type { ImportedWorkspaceData } from "@/features/workspace-manager/utils/importWorkspace";
import { importWorkspace } from "@/features/workspace-manager/data/workspaceBridge";

interface ImportModalState {
    isOpen: boolean;
    name: string;
    preview: ImportedWorkspaceData | null;
    isImporting: boolean;
    open: (data: ImportedWorkspaceData) => void;
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
            await importWorkspace({ ...preview, name });
        } finally {
            set({ isImporting: false });
        }
        get().close();
    },

    close: () => set({ isOpen: false, name: "", preview: null, isImporting: false }),
}));
