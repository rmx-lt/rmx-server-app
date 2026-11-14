import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { OBJECT_CATEGORY_OPTIONS } from "@/config/db-ops/enums";

export default function CategoryField() {
  const selectedObjectId = useCanvasSelectionStore((s) => s.selectedObject?.id);
  const category = useCanvasObjectStore(
    (s) => s.objects.find((o) => o.id === selectedObjectId)?.category,
  );

  const label =
    OBJECT_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? "—";

  return <InspectorPanelSectionField label="Category" value={label} />;
}

