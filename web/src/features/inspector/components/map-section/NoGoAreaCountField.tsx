import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useMapStore } from "@/model/mapStore";

export default function NoGoAreaCountField() {
  const count = useMapStore((s) => s.map.noGoAreaCount);

  return <InspectorPanelSectionField label="Number of no-go areas" value={String(count)} />;
}
