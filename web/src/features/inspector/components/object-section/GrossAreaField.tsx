import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { areaUnitLabel, convertArea, formatNumber, pickAutoAreaUnit } from "@/utils/unitOfMeasure";

export default function GrossAreaField() {
  const selectedObjectId = useCanvasSelectionStore((s) => s.selectedObject?.id);
  const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);
  const area = useCanvasObjectStore(
    (s) => s.objects.find((o) => o.id === selectedObjectId)?.area ?? 0,
  );

  const displayUnit = pickAutoAreaUnit(area, selectedUnit);
  return (
    <InspectorPanelSectionField
      label="Gross area"
      value={formatNumber(convertArea(area, selectedUnit, displayUnit), 2)}
      unit={areaUnitLabel(displayUnit)}
    />
  );
}

