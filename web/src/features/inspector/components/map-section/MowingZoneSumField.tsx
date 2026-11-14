import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useMapStore } from "@/model/mapStore";

export default function MowingZoneSumField() {
  const count = useMapStore((s) => s.map.mowingZoneCount);

  return <InspectorPanelSectionField label="Number of mowing zones" value={String(count)} />;
}
