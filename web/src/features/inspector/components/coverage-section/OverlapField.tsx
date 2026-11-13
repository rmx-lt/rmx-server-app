import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useComputeResultStore } from "@/model/useComputeResultStore";

export default function OverlapField() {
  const value = useComputeResultStore((s) => s.coverageMetrics.overlapRatioPct);
  const display = value == null || !Number.isFinite(value) ? "—" : value.toFixed(1);

  return <InspectorPanelSectionField label="Overlap ratio" value={display} unit="%" />;
}
