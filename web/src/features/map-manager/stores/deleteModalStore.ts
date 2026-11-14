import { create } from "zustand";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeleteModalState {
    requestDelete: (itemName: string, action: () => Promise<void>) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDeleteModalStore = create<DeleteModalState>()(() => ({
    requestDelete: (itemName, action) => {
        useConfirmationModalStore.getState().requestConfirmation({
            title: "Delete",
            message: `Delete "${itemName}"? This cannot be undone.`,
            tone: "danger",
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
            confirmAction: action,
        });
    },
}));
