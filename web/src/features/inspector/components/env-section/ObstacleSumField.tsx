import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useEnvStore } from "@/model/envStore";

export default function ObstacleSumField() {
  const count = useEnvStore((s) => s.env.obstacleCount);

  return <InspectorPanelSectionField label="Number of obstacles" value={String(count)} />;
}
