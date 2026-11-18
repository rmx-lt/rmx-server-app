import { GRID_SPACING, pickGridLevel } from "@/config/canvas-editing/canvasConfig";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { convertLinear, formatNumber, pickAutoLinearUnit, unitLabel } from "@/utils/unitOfMeasure";

/** Scale bar: as long as one grid cell at the current zoom, labelled in the map's unit. */
export default function CanvasScaleBar() {
    const scale = useCanvasViewStore((s) => s.scale);
    const unit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const cell = GRID_SPACING * pickGridLevel(scale); // map units
    const shown = pickAutoLinearUnit(cell, unit);
    const label = `${formatNumber(convertLinear(cell, unit, shown), 3)} ${unitLabel(shown)}`.trim();

    return (
        <div className="ml-auto flex items-center gap-2 text-xs text-muted" aria-label={`Scale: ${label}`}>
            <span>{label}</span>
            <span className="h-1.5 border-x border-b border-muted" style={{ width: cell * scale }} />
        </div>
    );
}
