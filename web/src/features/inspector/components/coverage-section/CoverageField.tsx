import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useComputeResultStore } from "@/model/useComputeResultStore";

export default function CoverageField() {
  const value = useComputeResultStore((s) => s.coverageMetrics.coverageRatioPct);
  const display = value == null || !Number.isFinite(value) ? "—" : value.toFixed(1);

  return <InspectorPanelSectionField label="Coverage ratio" value={display} unit="%" />;
}
