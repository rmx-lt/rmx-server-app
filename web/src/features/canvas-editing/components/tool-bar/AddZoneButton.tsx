import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function AddZoneButton() {
  const { activeTool, setActiveTool } = useCanvasToolStore();
  const cancelDrawing = useCanvasDrawingStore((s) => s.cancelDrawing);
  const isActive = activeTool === "addZone";

  return (
    <ToolBarButton
      title="Add Zone"
      shortcut={S["canvas.tool-add-zone"].shortcut}
      icon="rectangle_add"
      isActive={isActive}
      onClick={() => {
        cancelDrawing();
        setActiveTool(isActive ? null : "addZone");
      }}
    />
  );
}
