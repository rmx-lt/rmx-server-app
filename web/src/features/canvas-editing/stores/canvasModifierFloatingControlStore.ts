import { create } from "zustand";

interface CanvasModifierFloatingControlState {
    isOpen: boolean;
    setOpen: (open: boolean) => void;
}

export const useCanvasModifierFloatingControlStore = create<CanvasModifierFloatingControlState>((set) => ({
    isOpen: false,
    setOpen: (open) => set({ isOpen: open }),
}));
