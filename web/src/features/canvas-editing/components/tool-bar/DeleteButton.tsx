import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function DeleteButton() {
  const { activeTool, setActiveTool } = useCanvasToolStore();
  const cancelDrawing = useCanvasDrawingStore((s) => s.cancelDrawing);
  const { deleteObject, deleteVertices } = useCanvasObjectStore();
  const { selectedObject, selectedVertexRefs, clearSelection, selectVertex } =
    useCanvasSelectionStore();

  const isActive = activeTool === "delete";
  const hasSelection = selectedObject !== null;
  const hasVertexSelection = selectedVertexRefs.length > 0;
  const isInSelectModeWithSelection = activeTool === "select" && hasSelection;

  function handleClick() {
    if (isActive) {
      setActiveTool(null);
      return;
    }
    if (isInSelectModeWithSelection) {
      if (hasVertexSelection) {
        deleteVertices(selectedObject!, selectedVertexRefs);
        selectVertex(null);
      } else {
        deleteObject(selectedObject!);
        clearSelection();
      }
      return;
    }
    cancelDrawing();
    setActiveTool("delete");
  }

  return (
    <ToolBarButton
      title="Delete"
      shortcut={S["canvas.tool-delete"].shortcut}
      icon="delete"
      isActive={isActive}
      onClick={handleClick}
    />
  );
}
