import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function AddMowingZoneButton() {
  const { activeTool, setActiveTool } = useCanvasToolStore();
  const cancelDrawing = useCanvasDrawingStore((s) => s.cancelDrawing);
  const isActive = activeTool === "addMowingZone";

  return (
    <ToolBarButton
      title="Add Mowing Zone"
      shortcut={S["canvas.tool-add-mowing-zone"].shortcut}
      icon="rectangle_add"
      isActive={isActive}
      onClick={() => {
        cancelDrawing();
        setActiveTool(isActive ? null : "addMowingZone");
      }}
    />
  );
}
