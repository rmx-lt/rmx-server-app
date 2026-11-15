import { useEffect } from "react";
import { useShortcut, addShortcutBlockListener, removeShortcutBlockListener } from "@/hooks/shortcut-manager/useShortcut";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useMapPickerStore } from "@/features/map-manager/stores/mapPickerStore";
import { useSaveModalStore } from "@/features/map-manager/stores/saveModalStore";
import { useSaveAsModalStore } from "@/features/map-manager/stores/saveAsModalStore";
import { useSaveModeStore } from "@/model/saveModeStore";
import { useUiControlsPanelStore } from "@/features/ui-manager/stores/uiControlsPanelStore";
import { useUiInspectorPanelStore } from "@/features/ui-manager/stores/uiInspectorPanelStore";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { saveCanvas } from "@/features/canvas-editing/data/canvasBridge";
import { resetMap } from "@/features/map-manager/data/mapBridge";

/**
 * Registers all shortcuts that are scoped to the Workbench.
 * Mount this once inside WorkbenchWindow — shortcuts are active for
 * as long as the workbench is rendered and automatically cleaned up on unmount.
 */
export function useWorkbenchShortcuts() {
    useEffect(() => {
        const deactivateTools = () => {
            useCanvasDrawingStore.getState().cancelDrawing();
            useCanvasToolStore.getState().setActiveTool(null);
        };

        addShortcutBlockListener(deactivateTools);
        return () => removeShortcutBlockListener(deactivateTools);
    }, []);

    useShortcut("map.new", S["map.new"].keys, () =>
        useSaveModalStore.getState().requestWithSaveGuard(resetMap),
    );

    useShortcut("map.save-as", S["map.save-as"].keys, () =>
        useSaveAsModalStore.getState().open().catch(console.error),
    );

    useShortcut("map.open", S["map.open"].keys, () =>
        useMapPickerStore.getState().open(),
    );

    useShortcut("map.save", S["map.save"].keys, () => {
        const { mode, setMode, isAutoSaveEnabled } = useSaveModeStore.getState();
        saveCanvas()
            .then((saved) => {
                if (saved && mode === "session") setMode(isAutoSaveEnabled ? "autosave" : "manual");
            })
            .catch(console.error);
    });

    useShortcut("controls.toggle", S["controls.toggle"].keys, () =>
        useUiControlsPanelStore
            .getState()
            .setVisibility(!useUiControlsPanelStore.getState().isVisible),
    );

    useShortcut("inspector.toggle", S["inspector.toggle"].keys, () =>
        useUiInspectorPanelStore
            .getState()
            .setVisibility(!useUiInspectorPanelStore.getState().isVisible),
    );

    useShortcut("canvas.reset-view", S["canvas.reset-view"].keys, () =>
        useCanvasViewStore.getState().resetView(),
    );

    useShortcut("canvas.tool-select", S["canvas.tool-select"].keys, () => {
        const { activeTool, setActiveTool } = useCanvasToolStore.getState();
        useCanvasDrawingStore.getState().cancelDrawing();
        setActiveTool(activeTool === "select" ? null : "select");
    });

    useShortcut("canvas.tool-add-mowing-zone", S["canvas.tool-add-mowing-zone"].keys, () => {
        const { activeTool, setActiveTool } = useCanvasToolStore.getState();
        useCanvasDrawingStore.getState().cancelDrawing();
        setActiveTool(activeTool === "addMowingZone" ? null : "addMowingZone");
    });

    useShortcut("canvas.tool-add-no-go-zone", S["canvas.tool-add-no-go-zone"].keys, () => {
        const { activeTool, setActiveTool } = useCanvasToolStore.getState();
        useCanvasDrawingStore.getState().cancelDrawing();
        setActiveTool(activeTool === "addNoGoZone" ? null : "addNoGoZone");
    });

    useShortcut("canvas.tool-delete", S["canvas.tool-delete"].keys, () => {
        const { activeTool, setActiveTool } = useCanvasToolStore.getState();
        const { selectedObject, selectedVertexRefs, clearSelection, selectVertex } =
            useCanvasSelectionStore.getState();
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
    });

    useShortcut("canvas.undo", S["canvas.undo"].keys, () =>
        useCanvasHistoryStore.getState().undo(),
    );

    useShortcut("canvas.redo", S["canvas.redo"].keys, () =>
        useCanvasHistoryStore.getState().redo(),
    );
}
