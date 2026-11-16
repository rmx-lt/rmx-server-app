import { create } from "zustand";
import type { Area } from "@/data/planning/schemaTypes";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import { sameVertexRef } from "@/features/canvas-editing/utils/canvasObjectUtils";

interface CanvasSelectionState {
    selectedObject: Area | null;
    selectedVertexRefs: VertexRef[];

    selectObject: (obj: Area) => void;
    clearSelection: () => void;
    selectVertex: (ref: VertexRef | null) => void;
    toggleVertexSelection: (ref: VertexRef, ctrl: boolean) => void;
}

export const useCanvasSelectionStore = create<CanvasSelectionState>((set) => ({
    selectedObject: null,
    selectedVertexRefs: [],

    selectObject: (obj) =>
        set({ selectedObject: obj, selectedVertexRefs: [] }),

    clearSelection: () =>
        set({ selectedObject: null, selectedVertexRefs: [] }),

    selectVertex: (ref) =>
        set({ selectedVertexRefs: ref !== null ? [ref] : [] }),

    toggleVertexSelection: (ref, ctrl) =>
        set((state) => {
            if (!ctrl) {
                const alreadySoleSelected =
                    state.selectedVertexRefs.length === 1 && sameVertexRef(state.selectedVertexRefs[0]!, ref);
                return { selectedVertexRefs: alreadySoleSelected ? [] : [ref] };
            }
            const alreadySelected = state.selectedVertexRefs.some((sv) => sameVertexRef(sv, ref));
            return {
                selectedVertexRefs: alreadySelected
                    ? state.selectedVertexRefs.filter((sv) => !sameVertexRef(sv, ref))
                    : [...state.selectedVertexRefs, ref],
            };
        }),
}));
