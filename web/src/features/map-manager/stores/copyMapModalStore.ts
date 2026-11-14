import { create } from "zustand";
import { useMapStore } from "@/model/mapStore";
import { copyMap, openMap } from "@/features/map-manager/data/mapBridge";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";
import { useSaveModalStore } from "@/features/map-manager/stores/saveModalStore";
import { listMaps, type MapListItem } from "@/data/planning/maps";

interface CopyMapModalState {
    isOpen: boolean;
    name: string;
    maps: MapListItem[];
    isCopying: boolean;
    open: () => Promise<void>;
    close: () => void;
    setName: (name: string) => void;
    copy: () => Promise<void>;
}

export const useCopyMapModalStore = create<CopyMapModalState>((set, get) => ({
    isOpen: false,
    name: "",
    maps: [],
    isCopying: false,

    open: async () => {
        const currentName = useMapStore.getState().map.name;
        const maps = await listMaps().catch((err: unknown) => {
            console.error(err);
            return [];
        });
        set({ isOpen: true, name: `${currentName} (copy)`, maps, isCopying: false });
    },

    close: () => {
        set({ isOpen: false, name: "", maps: [], isCopying: false });
    },

    setName: (name) => set({ name }),

    copy: async () => {
        if (get().isCopying) return;
        set({ isCopying: true });
        const { name } = get();
        let newId: number;
        try {
            newId = await copyMap(name);
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
                    await openMap(newId);
                });
            },
        });
    },
}));
