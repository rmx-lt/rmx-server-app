import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";

export default function VertexSumField() {
  const selectedObjectId = useCanvasSelectionStore((s) => s.selectedObject?.id);
  const count = useCanvasObjectStore(
    (s) => s.objects.find((o) => o.id === selectedObjectId)?.vertexCount ?? 0,
  );

  return (
    <InspectorPanelSectionField label="Number of vertices" value={count} />
  );
}

