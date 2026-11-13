import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useEnvStore } from "@/model/envStore";

export default function ZoneSumField() {
  const count = useEnvStore((s) => s.env.zoneCount);

  return <InspectorPanelSectionField label="Number of zones" value={String(count)} />;
}
