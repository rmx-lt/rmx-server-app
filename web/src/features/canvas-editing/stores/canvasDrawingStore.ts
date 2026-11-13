import { create } from "zustand";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";

interface CanvasDrawingState {
    drawingPoints: Point[];
    mousePos: Point | null;
    pointerPos: Point | null;

    setDrawingPoints: (points: Point[]) => void;
    appendDrawingPoint: (point: Point) => void;
    setMousePos: (pos: Point | null) => void;
    setPointerPos: (pos: Point | null) => void;
    cancelDrawing: () => void;
}

export const useCanvasDrawingStore = create<CanvasDrawingState>((set) => ({
    drawingPoints: [],
    mousePos: null,
    pointerPos: null,

    setDrawingPoints: (points) => set({ drawingPoints: points }),
    appendDrawingPoint: (point) =>
        set((state) => ({ drawingPoints: [...state.drawingPoints, point] })),
    setMousePos: (pos) => set({ mousePos: pos }),
    setPointerPos: (pos) => set({ pointerPos: pos }),
    cancelDrawing: () => set({ drawingPoints: [], mousePos: null }),
}));
