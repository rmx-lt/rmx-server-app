import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { useComputeResultStore } from "@/model/useComputeResultStore";
import { convertLinear, formatNumber, pickAutoLinearUnit, unitLabel } from "@/utils/unitOfMeasure";

export default function PathLengthField() {
    const value = useComputeResultStore((s) => s.coverageMetrics.pathLength);
    const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    if (value == null || !Number.isFinite(value)) {
        return <InspectorPanelSectionField label="Path length" value="—" />;
    }

    const displayUnit = pickAutoLinearUnit(value, selectedUnit);
    return <InspectorPanelSectionField label="Path length" value={formatNumber(convertLinear(value, selectedUnit, displayUnit), 2)} unit={unitLabel(displayUnit)} />;
}
