import type { ActiveTool } from "@/features/canvas-editing/types/canvas";
import { ZOOM_MAX, ZOOM_MIN } from "@/config/canvas-editing/canvasConfig";
import { useModeStore } from "@/model/modeStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";

// What the tool strip and the shortcuts both do. Planning tools work in Plan mode only.

const inPlanMode = () => useModeStore.getState().mode === "plan";

/** Switches a tool on, or off when it is the active one. */
export function toggleTool(tool: ActiveTool): void {
    if (!inPlanMode()) return;
    const { activeTool, setActiveTool } = useCanvasToolStore.getState();
    useCanvasDrawingStore.getState().cancelDrawing();
    setActiveTool(activeTool === tool ? null : tool);
}

/** Delete: removes the selected vertices or area, else switches the delete tool on or off. */
export function deleteAction(): void {
    if (!inPlanMode()) return;
    const { activeTool, setActiveTool } = useCanvasToolStore.getState();
    const { selectedObject, selectedVertexRefs, clearSelection, selectVertex } = useCanvasSelectionStore.getState();
    const { deleteObject, deleteVertices } = useCanvasObjectStore.getState();
    if (activeTool === "select" && selectedObject !== null) {
        if (selectedVertexRefs.length > 0) {
            deleteVertices(selectedObject, selectedVertexRefs);
            selectVertex(null);
        } else {
            deleteObject(selectedObject);
            clearSelection();
        }
        return;
    }
    useCanvasDrawingStore.getState().cancelDrawing();
    setActiveTool(activeTool === "delete" ? null : "delete");
}

export function undoAction(): void {
    if (inPlanMode()) useCanvasHistoryStore.getState().undo();
}

export function redoAction(): void {
    if (inPlanMode()) useCanvasHistoryStore.getState().redo();
}

/** Zooms and moves the view so that every area is visible. */
export function fitView(): void {
    const { objects } = useCanvasObjectStore.getState();
    const { canvasSize, animateTo } = useCanvasViewStore.getState();
    const vertices = objects.flatMap((o) => o.vertices);
    if (vertices.length === 0 || canvasSize.width === 0) return;
    const xs = vertices.map((v) => v.x);
    const ys = vertices.map((v) => v.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const margin = 0.8; // leave room around the areas, and for the tool strip
    const fit = Math.min(
        (canvasSize.width * margin) / Math.max(maxX - minX, 1),
        (canvasSize.height * margin) / Math.max(maxY - minY, 1),
    );
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit));
    animateTo(scale, {
        x: canvasSize.width / 2 - ((minX + maxX) / 2) * scale,
        y: canvasSize.height / 2 - ((minY + maxY) / 2) * scale,
    });
}
