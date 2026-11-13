import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function AddObstacleButton() {
  const { activeTool, setActiveTool } = useCanvasToolStore();
  const cancelDrawing = useCanvasDrawingStore((s) => s.cancelDrawing);
  const isActive = activeTool === "addObstacle";

  return (
    <ToolBarButton
      title="Add Obstacle"
      shortcut={S["canvas.tool-add-obstacle"].shortcut}
      icon="add_triangle"
      isActive={isActive}
      onClick={() => {
        cancelDrawing();
        setActiveTool(isActive ? null : "addObstacle");
      }}
    />
  );
}
