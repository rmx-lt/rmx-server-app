import { create } from "zustand";
import { useEnvStore } from "@/model/envStore";
import { copyWorkspace, loadWorkspace } from "@/features/workspace-manager/data/workspaceBridge";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";
import { useSaveModalStore } from "@/features/workspace-manager/stores/saveModalStore";
import { listMaps, type MapListItem } from "@/data/planning/maps";

interface CopyWorkspaceModalState {
    isOpen: boolean;
    name: string;
    environments: MapListItem[];
    isCopying: boolean;
    open: () => Promise<void>;
    close: () => void;
    setName: (name: string) => void;
    copy: () => Promise<void>;
}

export const useCopyWorkspaceModalStore = create<CopyWorkspaceModalState>((set, get) => ({
    isOpen: false,
    name: "",
    environments: [],
    isCopying: false,

    open: async () => {
        const currentName = useEnvStore.getState().env.name;
        const environments = await listMaps().catch((err: unknown) => {
            console.error(err);
            return [];
        });
        set({ isOpen: true, name: `${currentName} (copy)`, environments, isCopying: false });
    },

    close: () => {
        set({ isOpen: false, name: "", environments: [], isCopying: false });
    },

    setName: (name) => set({ name }),

    copy: async () => {
        if (get().isCopying) return;
        set({ isCopying: true });
        const { name } = get();
        let newId: number;
        try {
            newId = await copyWorkspace(name);
        } catch (err) {
            set({ isCopying: false });
            get().close();
            useConfirmationModalStore.getState().requestConfirmation({
                title: "Copy Failed",
                message: err instanceof Error ? err.message : "An unexpected error occurred.",
                tone: "danger",
                confirmLabel: "Dismiss",
            });
            return;
        }
        set({ isCopying: false });
        get().close();
        useConfirmationModalStore.getState().requestConfirmation({
            title: "Copy Created",
            message: `"${name}" was created. Open it now?`,
            confirmLabel: "Open",
            cancelLabel: "Stay",
            confirmAction: async () => {
                useSaveModalStore.getState().requestWithSaveGuard(async () => {
                    await loadWorkspace(newId);
                });
            },
        });
    },
}));
