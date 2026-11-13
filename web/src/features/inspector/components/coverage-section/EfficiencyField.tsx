import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useComputeResultStore } from "@/model/useComputeResultStore";

export default function EfficiencyField() {
    const value = useComputeResultStore((s) => s.coverageMetrics.efficiency);
    const display = value == null || !Number.isFinite(value) ? "—" : value.toFixed(1);

    return <InspectorPanelSectionField label="Efficiency" value={display} unit="%" />;
}
