import { create } from "zustand";

interface CanvasHeatMapScaleFloatingControlState {
    isOpen: boolean;
    setOpen: (open: boolean) => void;
}

export const useCanvasHeatMapScaleFloatingControlStore = create<CanvasHeatMapScaleFloatingControlState>((set) => ({
    isOpen: false,
    setOpen: (open) => set({ isOpen: open }),
}));
