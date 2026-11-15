import { useEffect } from "react";
import { useShortcut, addShortcutBlockListener, removeShortcutBlockListener } from "@/hooks/shortcut-manager/useShortcut";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useUiShellStore } from "@/features/ui-manager/stores/uiShellStore";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { deleteAction, redoAction, toggleTool, undoAction } from "@/features/canvas-editing/data/canvasActions";
import { newMap } from "@/features/map-manager/data/mapBridge";

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

    useShortcut("map.new", S["map.new"].keys, () => void newMap().catch(console.error));

    useShortcut("controls.toggle", S["controls.toggle"].keys, () => useUiShellStore.getState().toggleSide());

    useShortcut("inspector.toggle", S["inspector.toggle"].keys, () => useUiShellStore.getState().toggleRight());

    useShortcut("canvas.reset-view", S["canvas.reset-view"].keys, () =>
        useCanvasViewStore.getState().resetView(),
    );

    useShortcut("canvas.tool-select", S["canvas.tool-select"].keys, () => toggleTool("select"));
    useShortcut("canvas.tool-add-mowing-zone", S["canvas.tool-add-mowing-zone"].keys, () => toggleTool("addMowingZone"));
    useShortcut("canvas.tool-add-no-go-zone", S["canvas.tool-add-no-go-zone"].keys, () => toggleTool("addNoGoZone"));
    useShortcut("canvas.tool-delete", S["canvas.tool-delete"].keys, deleteAction);
    useShortcut("canvas.undo", S["canvas.undo"].keys, undoAction);
    useShortcut("canvas.redo", S["canvas.redo"].keys, redoAction);
}
