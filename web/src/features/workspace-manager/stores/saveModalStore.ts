import { create } from "zustand";
import { useSaveStatusStore } from "@/features/canvas-editing/stores/saveStatusStore";
import { isMapDirty, saveCanvas } from "@/features/canvas-editing/data/canvasBridge";
import { useSaveModeStore } from "@/model/saveModeStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SaveModalState {
    requestWithSaveGuard: (action: () => Promise<void>) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSaveModalStore = create<SaveModalState>()(() => ({
    requestWithSaveGuard: (action) => {
        const { status } = useSaveStatusStore.getState();
        if (status !== "unsaved") {
            action().catch(console.error);
            return;
        }

        useConfirmationModalStore.getState().requestConfirmation({
            title: "Unsaved Changes",
            message: "Your changes will be lost if you don't save them.",
            tone: "warning",
            confirmLabel: "Save",
            secondaryLabel: "Don't Save",
            cancelLabel: "Cancel",
            confirmAction: async () => {
                const saved = await saveCanvas();
                // The save failed (the user was told why): keep the changes, don't go on.
                if (!saved && isMapDirty()) return;

                if (saved) {
                    const { mode, setMode, isAutoSaveEnabled } = useSaveModeStore.getState();
                    if (mode === "session") {
                        setMode(isAutoSaveEnabled ? "autosave" : "manual");
                    }
                }

                await action();
            },
            secondaryAction: async () => {
                await action();
            },
        });
    },
}));
