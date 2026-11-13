import { create } from "zustand";
import type { ActiveTool } from "@/features/canvas-editing/types/canvas";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";

interface CanvasToolState {
    activeTool: ActiveTool | null;
    setActiveTool: (tool: ActiveTool | null) => void;
}

export const useCanvasToolStore = create<CanvasToolState>((set) => ({
    activeTool: null,
    setActiveTool: (tool) => {
        if (tool !== "select") {
            useCanvasSelectionStore.getState().clearSelection();
        }
        set({ activeTool: tool });
    },
}));
