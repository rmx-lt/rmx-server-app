import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";

export default function CanvasRedoButton() {
    const redo = useCanvasHistoryStore((s) => s.redo);
    const canRedo = useCanvasHistoryStore((s) => s.canRedo);

    return (
        <MenuBarItem
            label="Redo"
            shortcut={S["canvas.redo"].shortcut}
            onClick={canRedo ? redo : undefined}
        />
    );
}
