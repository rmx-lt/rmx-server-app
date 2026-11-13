import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";

export default function CanvasUndoButton() {
    const undo = useCanvasHistoryStore((s) => s.undo);
    const canUndo = useCanvasHistoryStore((s) => s.canUndo);

    return (
        <MenuBarItem
            label="Undo"
            shortcut={S["canvas.undo"].shortcut}
            onClick={canUndo ? undo : undefined}
        />
    );
}
