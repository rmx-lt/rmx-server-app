import { create } from "zustand";

interface UiStatusBarState {
    isVisible: boolean;
    setVisibility: (visible: boolean) => void;
}

export const useUiStatusBarStore = create<UiStatusBarState>((set) => ({
    isVisible: true,
    setVisibility: (visible) => set({ isVisible: visible }),
}));
