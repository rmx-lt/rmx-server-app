import { create } from "zustand";

interface UiControlsPanelState {
    isVisible: boolean;
    isDragCollapsed: boolean;
    width: number;
    setVisibility: (visible: boolean) => void;
    setDragCollapsed: (collapsed: boolean) => void;
    setWidth: (width: number) => void;
}

export const useUiControlsPanelStore = create<UiControlsPanelState>((set) => ({
    isVisible: true,
    isDragCollapsed: false,
    width: 300, // Default width in pixels
    setVisibility: (visible) => set({ isVisible: visible }),
    setDragCollapsed: (collapsed) => set({ isDragCollapsed: collapsed }),
    setWidth: (width) => set({ width }),
}));
