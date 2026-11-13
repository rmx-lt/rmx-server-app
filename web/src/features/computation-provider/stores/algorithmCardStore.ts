import { create } from "zustand";
import type { ComputationAlgorithmDetails } from "@/data/local/serviceTypes";

interface AlgorithmCardState {
    isOpen: boolean;
    algorithmDetails: ComputationAlgorithmDetails | null;
    isDraft: boolean;
    onDraftNameChange: ((newName: string) => void) | null;
    onDraftSave: ((updatedDetails: ComputationAlgorithmDetails) => Promise<boolean>) | null;
    onDraftDelete: (() => void) | null;

    openSaved: (details: ComputationAlgorithmDetails) => void;
    openDraft: (
        details: ComputationAlgorithmDetails,
        onNameChange: (newName: string) => void,
        onSave: (updatedDetails: ComputationAlgorithmDetails) => Promise<boolean>,
        onDelete: () => void,
    ) => void;
    close: () => void;
}

export const useAlgorithmCardStore = create<AlgorithmCardState>()((set) => ({
    isOpen: false,
    algorithmDetails: null,
    isDraft: false,
    onDraftNameChange: null,
    onDraftSave: null,
    onDraftDelete: null,

    openSaved: (details) => set({
        isOpen: true,
        algorithmDetails: details,
        isDraft: false,
        onDraftNameChange: null,
        onDraftSave: null,
        onDraftDelete: null,
    }),

    openDraft: (details, onNameChange, onSave, onDelete) => set({
        isOpen: true,
        algorithmDetails: details,
        isDraft: true,
        onDraftNameChange: onNameChange,
        onDraftSave: onSave,
        onDraftDelete: onDelete,
    }),

    close: () => set({
        isOpen: false,
        algorithmDetails: null,
        isDraft: false,
        onDraftNameChange: null,
        onDraftSave: null,
        onDraftDelete: null,
    }),
}));
