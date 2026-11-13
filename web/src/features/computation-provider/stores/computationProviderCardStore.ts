import { create } from "zustand";

interface ComputationProviderCardState {
    isOpen: boolean;
    selectedProviderId: number | null;
    open: (id: number | null) => void;
    close: () => void;
    setSelectedProviderId: (id: number | null) => void;
}

export const useComputationProviderCardStore = create<ComputationProviderCardState>()((set) => ({
    isOpen: false,
    selectedProviderId: null,
    open: (id) => set({ isOpen: true, selectedProviderId: id }),
    close: () => set({ isOpen: false, selectedProviderId: null }),
    setSelectedProviderId: (id) => set({ selectedProviderId: id }),
}));
