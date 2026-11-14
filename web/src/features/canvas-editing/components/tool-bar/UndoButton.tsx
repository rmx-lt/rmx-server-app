import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";

export default function UndoButton() {
    const undo = useCanvasHistoryStore((s) => s.undo);
    const canUndo = useCanvasHistoryStore((s) => s.canUndo);

    return (
        <ToolBarButton
            title="Undo"
            shortcut={S["canvas.undo"].shortcut}
            icon="undo"
            isDisabled={!canUndo}
            onClick={undo}
        />
    );
}
