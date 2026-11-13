import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { convertLinear, formatNumber, pickAutoLinearUnit, unitLabel } from "@/utils/unitOfMeasure";

export default function CanvasPointerPosition() {
    const pointerPos = useCanvasDrawingStore((s) => s.pointerPos);
    const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const displayUnit = pointerPos
        ? pickAutoLinearUnit(Math.max(Math.abs(pointerPos.x), Math.abs(pointerPos.y)), selectedUnit)
        : selectedUnit;
    const unit = unitLabel(displayUnit);

    const display = pointerPos
        ? `${formatNumber(convertLinear(pointerPos.x, selectedUnit, displayUnit), 2)}, ${formatNumber(convertLinear(pointerPos.y, selectedUnit, displayUnit), 2)}${unit ? ` ${unit}` : ""}`
        : "";

    return (
        <div className="flex items-center gap-1 h-5 px-1.5 text-xs text-gray-500 select-none tabular-nums min-w-28">
            <span className="material-symbols-outlined text-gray-400 shrink-0" style={{ fontSize: 14 }}>
                near_me
            </span>
            <span>{display}</span>
        </div>
    );
}
