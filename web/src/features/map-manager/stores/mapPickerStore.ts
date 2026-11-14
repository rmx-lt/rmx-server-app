import { create } from "zustand";

interface MapPickerState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useMapPickerStore = create<MapPickerState>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
