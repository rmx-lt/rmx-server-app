import { create } from "zustand";

interface WorkspacePickerState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useWorkspacePickerStore = create<WorkspacePickerState>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
