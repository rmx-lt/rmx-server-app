import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { GRID_SPACING, pickGridLevel } from "@/config/canvas-editing/canvasConfig";
import { convertLinear, formatNumber, pickAutoLinearUnit, unitLabel } from "@/utils/unitOfMeasure";

export default function CanvasGridScale() {
    const scale = useCanvasViewStore((s) => s.scale);
    const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);
    const level = pickGridLevel(scale);
    const cellWorldBase = GRID_SPACING * level;
    const displayUnit = pickAutoLinearUnit(cellWorldBase, selectedUnit);
    const cellWorld = convertLinear(cellWorldBase, selectedUnit, displayUnit);
    const unit = unitLabel(displayUnit);
    const cellPx = Math.round(GRID_SPACING * level * scale);

    return (
        <div className="flex items-center gap-1.5 h-5 px-1.5 text-xs text-gray-500 select-none tabular-nums">
            <span>{`${formatNumber(cellWorld, 2)}${unit ? ` ${unit}` : ""}`}</span>
            <div className="flex items-end">
                <div className="w-px h-2 bg-gray-400" />
                <div className="border-t border-gray-400" style={{ width: cellPx }} />
                <div className="w-px h-2 bg-gray-400" />
            </div>
        </div>
    );
}
