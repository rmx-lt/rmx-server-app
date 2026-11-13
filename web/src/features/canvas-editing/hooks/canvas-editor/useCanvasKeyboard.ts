import { useCallback } from "react";
import type { Object } from "@/data/local/schemaTypes";
import type { EnvPointType } from "@/data/local/schemaTypes";
import type { ActiveTool, VertexRef } from "@/features/canvas-editing/types/canvas";

interface UseCanvasKeyboardOptions {
    activeTool: ActiveTool | null;
    drawingPointsCount: number;
    selectedObject: Object | null;
    selectedVertexRefs: VertexRef[];
    selectedEnvPointType: EnvPointType | null;
    envPointEnvironmentId: number | null;
    setActiveTool: (tool: ActiveTool | null) => void;
    clearSelection: () => void;
    selectVertex: (ref: VertexRef | null) => void;
    deleteObject: (obj: Object) => void;
    deleteVertex: (obj: Object, index: number) => void;
    deleteVertices: (obj: Object, refs: VertexRef[]) => void;
    deleteEnvPoint: (environmentId: number, type: EnvPointType) => void;
    cancelDrawing: () => void;
}

export function useCanvasKeyboard({
    activeTool,
    drawingPointsCount,
    selectedObject,
    selectedVertexRefs,
    selectedEnvPointType,
    envPointEnvironmentId,
    setActiveTool,
    clearSelection,
    selectVertex,
    deleteObject,
    deleteVertex,
    deleteVertices,
    deleteEnvPoint,
    cancelDrawing,
}: UseCanvasKeyboardOptions) {
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === "Escape") {
                e.preventDefault();
                if (activeTool === "addZone" || activeTool === "addObstacle") {
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
                    } else if (selectedEnvPointType !== null) {
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
                } else if (selectedEnvPointType !== null && envPointEnvironmentId !== null) {
                    deleteEnvPoint(envPointEnvironmentId, selectedEnvPointType);
                    clearSelection();
                }
            }
        },
        [
            activeTool,
            drawingPointsCount,
            selectedObject,
            selectedVertexRefs,
            selectedEnvPointType,
            envPointEnvironmentId,
            setActiveTool,
            clearSelection,
            selectVertex,
            deleteObject,
            deleteVertex,
            deleteVertices,
            deleteEnvPoint,
            cancelDrawing,
        ],
    );

    return { handleKeyDown };
}
