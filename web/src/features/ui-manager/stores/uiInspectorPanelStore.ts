import { create } from "zustand";

interface UiInspectorPanelState {
    isVisible: boolean;
    isDragCollapsed: boolean;
    width: number;
    setVisibility: (visible: boolean) => void;
    setDragCollapsed: (collapsed: boolean) => void;
    setWidth: (width: number) => void;
}

export const useUiInspectorPanelStore = create<UiInspectorPanelState>(
    (set) => ({
        isVisible: true,
        isDragCollapsed: false,
        width: 300,
        setVisibility: (visible) => set({ isVisible: visible }),
        setDragCollapsed: (collapsed) => set({ isDragCollapsed: collapsed }),
        setWidth: (width) => set({ width }),
    }),
);
