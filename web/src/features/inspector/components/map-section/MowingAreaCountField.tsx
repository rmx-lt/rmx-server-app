import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useMapStore } from "@/model/mapStore";

export default function MowingAreaCountField() {
  const count = useMapStore((s) => s.map.mowingAreaCount);

  return <InspectorPanelSectionField label="Number of mowing areas" value={String(count)} />;
}
