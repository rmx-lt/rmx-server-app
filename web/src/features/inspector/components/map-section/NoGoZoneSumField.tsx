import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useMapStore } from "@/model/mapStore";

export default function NoGoZoneSumField() {
  const count = useMapStore((s) => s.map.noGoZoneCount);

  return <InspectorPanelSectionField label="Number of no-go zones" value={String(count)} />;
}
