import { create } from "zustand";
import type { Environment } from "@/data/local/schemaTypes";
import { getAllEnvironments } from "@/data/local/environments";
import { useEnvStore } from "@/model/envStore";
import { saveAsWorkspace } from "@/features/workspace-manager/data/workspaceBridge";

interface SaveAsModalState {
    isOpen: boolean;
    environments: Environment[];
    name: string;
    /** The name the user typed before picking an overwrite target. Restored on deselect. */
    customName: string;
    /** When set, the save-as will overwrite this existing env instead of creating a new one. */
    selectedEnvId: number | null;
    isSaving: boolean;
    open: () => Promise<void>;
    close: () => void;
    setName: (name: string) => void;
    selectEnv: (id: number) => void;
    save: () => Promise<void>;
}

export const useSaveAsModalStore = create<SaveAsModalState>((set, get) => ({
    isOpen: false,
    environments: [],
    name: "",
    customName: "",
    selectedEnvId: null,
    isSaving: false,

    open: async () => {
        const currentName = useEnvStore.getState().env.name;
        const environments = await getAllEnvironments();
        set({
            isOpen: true,
            environments,
            name: currentName,
            customName: currentName,
            selectedEnvId: null,
            isSaving: false,
        });
    },

    close: () => {
        set({ isOpen: false, environments: [], name: "", customName: "", selectedEnvId: null, isSaving: false });
    },

    // Typing always deselects — user is switching to "new workspace" mode.
    setName: (name) => set({ name, customName: name, selectedEnvId: null }),

    selectEnv: (id) => {
        set((state) => {
            if (state.selectedEnvId === id) {
                // Deselect — restore the last name the user typed.
                return { selectedEnvId: null, name: state.customName };
            }
            const env = state.environments.find((e) => e.id === id);
            // Fill name with the selected workspace's name; keep customName for restore on deselect.
            return { selectedEnvId: id, name: env?.name ?? state.name };
        });
    },

    save: async () => {
        if (get().isSaving) return;
        set({ isSaving: true });
        try {
            const { name, selectedEnvId } = get();
            await saveAsWorkspace(name, selectedEnvId);
        } finally {
            set({ isSaving: false });
        }
        get().close();
    },
}));
