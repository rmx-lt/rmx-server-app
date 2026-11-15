import InspectorPanelSectionSelectField from "@/components/inspector-panel/InspectorPanelSectionSelectField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { ZONE_TYPE, ZONE_TYPE_OPTIONS, isMapTypeFixed, type ZoneType } from "@/config/db-ops/enums";
import { useMapStore } from "@/model/mapStore";

const TYPE_OPTIONS = ZONE_TYPE_OPTIONS.filter((o) => o.value !== ZONE_TYPE.EMPTY);

export default function TypeField() {
  const selectedObject = useCanvasSelectionStore((s) => s.selectedObject);
  const type = useCanvasObjectStore(
    (s) => s.objects.find((o) => o.id === selectedObject?.id)?.type,
  );
  const updateObjectType = useCanvasObjectStore((s) => s.updateObjectType);
  const mapType = useMapStore((s) => s.map.type);

  if (!selectedObject || type === undefined) return null;

  return (
    <InspectorPanelSectionSelectField
      label="Type"
      value={type}
      options={TYPE_OPTIONS}
      disabled={isMapTypeFixed(mapType)}
      onChange={(v) => updateObjectType(selectedObject, v as ZoneType)}
    />
  );
}

