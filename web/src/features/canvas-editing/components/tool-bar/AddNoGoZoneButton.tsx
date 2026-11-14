import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function AddNoGoZoneButton() {
  const { activeTool, setActiveTool } = useCanvasToolStore();
  const cancelDrawing = useCanvasDrawingStore((s) => s.cancelDrawing);
  const isActive = activeTool === "addNoGoZone";

  return (
    <ToolBarButton
      title="Add No-Go Zone"
      shortcut={S["canvas.tool-add-no-go-zone"].shortcut}
      icon="add_triangle"
      isActive={isActive}
      onClick={() => {
        cancelDrawing();
        setActiveTool(isActive ? null : "addNoGoZone");
      }}
    />
  );
}
