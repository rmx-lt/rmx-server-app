import { create } from "zustand";

interface GeoAnchorModalState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useGeoAnchorModalStore = create<GeoAnchorModalState>()((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
