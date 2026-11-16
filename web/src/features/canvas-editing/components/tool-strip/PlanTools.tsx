import { MousePointer2, Pentagon, Redo2, Square, Trash2, Undo2 } from "lucide-react";
import { ToolStripButton, ToolStripSeparator } from "@/components/tool-strip/ToolStrip";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { deleteAction, redoAction, toggleTool, undoAction } from "@/features/canvas-editing/data/canvasActions";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";

/** The tools of Plan mode. */
export default function PlanTools() {
    const activeTool = useCanvasToolStore((s) => s.activeTool);
    const canUndo = useCanvasHistoryStore((s) => s.canUndo);
    const canRedo = useCanvasHistoryStore((s) => s.canRedo);

    return (
        <>
            <ToolStripButton label="Select" icon={MousePointer2} shortcut={S["canvas.tool-select"].shortcut} active={activeTool === "select"} onClick={() => toggleTool("select")} />
            <ToolStripButton label="Mowing area" icon={Pentagon} shortcut={S["canvas.tool-add-mowing-area"].shortcut} active={activeTool === "addMowingArea"} onClick={() => toggleTool("addMowingArea")} />
            <ToolStripButton label="No-go area" icon={Square} shortcut={S["canvas.tool-add-no-go-area"].shortcut} active={activeTool === "addNoGoArea"} onClick={() => toggleTool("addNoGoArea")} />
            <ToolStripSeparator />
            <ToolStripButton label="Delete" icon={Trash2} shortcut={S["canvas.tool-delete"].shortcut} active={activeTool === "delete"} onClick={deleteAction} />
            <ToolStripSeparator />
            <ToolStripButton label="Undo" icon={Undo2} shortcut={S["canvas.undo"].shortcut} disabled={!canUndo} onClick={undoAction} />
            <ToolStripButton label="Redo" icon={Redo2} shortcut={S["canvas.redo"].shortcut} disabled={!canRedo} onClick={redoAction} />
        </>
    );
}
