import { create } from "zustand";
import { ZOOM_STEP, ZOOM_MIN, ZOOM_MAX } from "@/config/canvas-editing/canvasConfig";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";

interface CanvasViewState {
    position: Point;
    scale: number;
    canvasSize: { width: number; height: number };
    setPosition: (position: Point) => void;
    setScale: (scale: number) => void;
    setCanvasSize: (width: number, height: number) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    resetView: () => void;
}

export const useCanvasViewStore = create<CanvasViewState>((set, get) => ({
    position: { x: 0, y: 0 },
    scale: 1,
    canvasSize: { width: 0, height: 0 },

    setPosition: (position) => set({ position }),

    setCanvasSize: (width, height) => set({ canvasSize: { width, height } }),

    setScale: (scale) =>
        set({ scale: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale)) }),

    zoomIn: () =>
        set((state) => ({
            scale: Math.min(ZOOM_MAX, Math.round((state.scale + ZOOM_STEP) * 100) / 100),
        })),

    zoomOut: () =>
        set((state) => ({
            scale: Math.max(ZOOM_MIN, Math.round((state.scale - ZOOM_STEP) * 100) / 100),
        })),

    resetView: () => {
        const { canvasSize } = get();
        set({
            position: { x: canvasSize.width / 2, y: canvasSize.height / 2 },
            scale: 1,
        });
    },
}));
