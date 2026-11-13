import { create } from "zustand";

interface ComputationProvidersListModalState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useComputationProvidersListModalStore = create<ComputationProvidersListModalState>()((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
