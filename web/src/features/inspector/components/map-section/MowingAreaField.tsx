import { useMemo } from "react";
import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { computeNetArea } from "@/features/canvas-editing/utils/canvasGeometry";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { areaUnitLabel, convertArea, formatNumber, pickAutoAreaUnit } from "@/utils/unitOfMeasure";

/** Area to mow: the mowing areas, less the no-go areas inside them. */
export default function MowingAreaField() {
    const objects = useCanvasObjectStore((s) => s.objects);
    const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);
    const total = useMemo(() => objects.reduce((sum, o) => sum + (computeNetArea(o, objects) ?? 0), 0), [objects]);

    const displayUnit = pickAutoAreaUnit(total, selectedUnit);
    return (
        <InspectorPanelSectionField
            label="Area to mow"
            value={formatNumber(convertArea(total, selectedUnit, displayUnit), 2)}
            unit={areaUnitLabel(displayUnit)}
        />
    );
}
