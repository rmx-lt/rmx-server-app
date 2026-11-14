import { create } from "zustand";
import type { Object } from "@/data/local/schemaTypes";
import type { EnvPointType } from "@/data/local/schemaTypes";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import { sameVertexRef } from "@/features/canvas-editing/utils/canvasObjectUtils";

interface CanvasSelectionState {
    selectedObject: Object | null;
    selectedVertexRefs: VertexRef[];
    selectedEnvPointType: EnvPointType | null;

    selectObject: (obj: Object) => void;
    clearSelection: () => void;
    selectVertex: (ref: VertexRef | null) => void;
    toggleVertexSelection: (ref: VertexRef, ctrl: boolean) => void;
    selectEnvPoint: (type: EnvPointType) => void;
}

export const useCanvasSelectionStore = create<CanvasSelectionState>((set) => ({
    selectedObject: null,
    selectedVertexRefs: [],
    selectedEnvPointType: null,

    selectObject: (obj) =>
        set({ selectedObject: obj, selectedVertexRefs: [], selectedEnvPointType: null }),

    clearSelection: () =>
        set({ selectedObject: null, selectedVertexRefs: [], selectedEnvPointType: null }),

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

    selectEnvPoint: (type) =>
        set({ selectedEnvPointType: type, selectedObject: null, selectedVertexRefs: [] }),
}));
