import { useCallback } from "react";
import type { Zone } from "@/data/planning/schemaTypes";
import type { ActiveTool, VertexRef } from "@/features/canvas-editing/types/canvas";

interface UseCanvasKeyboardOptions {
    activeTool: ActiveTool | null;
    drawingPointsCount: number;
    selectedObject: Zone | null;
    selectedVertexRefs: VertexRef[];
    setActiveTool: (tool: ActiveTool | null) => void;
    clearSelection: () => void;
    selectVertex: (ref: VertexRef | null) => void;
    deleteObject: (obj: Zone) => void;
    deleteVertex: (obj: Zone, index: number) => void;
    deleteVertices: (obj: Zone, refs: VertexRef[]) => void;
    cancelDrawing: () => void;
}

export function useCanvasKeyboard({
    activeTool,
    drawingPointsCount,
    selectedObject,
    selectedVertexRefs,
    setActiveTool,
    clearSelection,
    selectVertex,
    deleteObject,
    deleteVertex,
    deleteVertices,
    cancelDrawing,
}: UseCanvasKeyboardOptions) {
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === "Escape") {
                e.preventDefault();
                if (activeTool === "addMowingZone" || activeTool === "addNoGoZone") {
                    if (drawingPointsCount > 0) {
                        cancelDrawing();
                    } else {
                        setActiveTool(null);
                    }
                } else if (activeTool === "select") {
                    if (selectedVertexRefs.length > 0) {
                        selectVertex(null); // deselect vertices, keep object selected
                    } else if (selectedObject !== null) {
                        clearSelection();
                    } else {
                        setActiveTool(null);
                    }
                } else if (activeTool === "delete") {
                    setActiveTool(null);
                }
                return;
            }

            if (e.key === "Delete" && activeTool === "select") {
                if (selectedObject !== null && selectedVertexRefs.length > 0) {
                    deleteVertices(selectedObject, selectedVertexRefs);
                    selectVertex(null);
                } else if (selectedObject !== null) {
                    deleteObject(selectedObject);
                    clearSelection();
                }
            }
        },
        [
            activeTool,
            drawingPointsCount,
            selectedObject,
            selectedVertexRefs,
                            setActiveTool,
            clearSelection,
            selectVertex,
            deleteObject,
            deleteVertex,
            deleteVertices,
                    cancelDrawing,
        ],
    );

    return { handleKeyDown };
}
