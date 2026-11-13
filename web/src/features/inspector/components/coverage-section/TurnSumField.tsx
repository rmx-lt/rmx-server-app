import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useComputeResultStore } from "@/model/useComputeResultStore";

export default function TurnSumField() {
  const value = useComputeResultStore((s) => s.coverageMetrics.turnCount);
  const display = value == null || !Number.isFinite(value) ? "—" : Math.round(value).toString();

  return <InspectorPanelSectionField label="Number of turns" value={display} />;
}
