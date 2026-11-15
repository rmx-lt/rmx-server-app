import { MousePointer2, Pentagon, Redo2, Square, Trash2, Undo2 } from "lucide-react";
import { ToolStripButton, ToolStripSeparator } from "@/components/tool-strip/ToolStrip";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { deleteAction, redoAction, toggleTool, undoAction } from "@/features/canvas-editing/data/canvasActions";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";

const hint = (id: keyof typeof S) => S[id].shortcut.join("+");

/** The tools of Plan mode. */
export default function PlanTools() {
    const activeTool = useCanvasToolStore((s) => s.activeTool);
    const canUndo = useCanvasHistoryStore((s) => s.canUndo);
    const canRedo = useCanvasHistoryStore((s) => s.canRedo);

    return (
        <>
            <ToolStripButton label="Select" icon={MousePointer2} hint={hint("canvas.tool-select")} active={activeTool === "select"} onClick={() => toggleTool("select")} />
            <ToolStripButton label="Mowing zone" icon={Pentagon} hint={hint("canvas.tool-add-mowing-zone")} active={activeTool === "addMowingZone"} onClick={() => toggleTool("addMowingZone")} />
            <ToolStripButton label="No-go zone" icon={Square} hint={hint("canvas.tool-add-no-go-zone")} active={activeTool === "addNoGoZone"} onClick={() => toggleTool("addNoGoZone")} />
            <ToolStripSeparator />
            <ToolStripButton label="Delete" icon={Trash2} hint={hint("canvas.tool-delete")} active={activeTool === "delete"} onClick={deleteAction} />
            <ToolStripSeparator />
            <ToolStripButton label="Undo" icon={Undo2} hint={hint("canvas.undo")} disabled={!canUndo} onClick={undoAction} />
            <ToolStripButton label="Redo" icon={Redo2} hint={hint("canvas.redo")} disabled={!canRedo} onClick={redoAction} />
        </>
    );
}
