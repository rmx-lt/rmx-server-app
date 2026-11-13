import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";

export default function RedoButton() {
    const redo = useCanvasHistoryStore((s) => s.redo);
    const canRedo = useCanvasHistoryStore((s) => s.canRedo);

    return (
        <ToolBarButton
            title="Redo"
            shortcut={S["canvas.redo"].shortcut}
            icon="redo"
            isDisabled={!canRedo}
            onClick={redo}
        />
    );
}
