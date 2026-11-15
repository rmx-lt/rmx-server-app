import { useState } from "react";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import {
    formatNumber,
    unitLabel,
    type UnitOfMeasure,
} from "@/utils/unitOfMeasure";

function CoordInput({
    label,
    baseValue,
    onCommit,
}: {
    label: string;
    baseValue: number;
    unit: UnitOfMeasure;
    onCommit: (v: number) => void;
}) {
    // The text being edited while the input has focus; null shows `baseValue`.
    const [draft, setDraft] = useState<string | null>(null);
    const isFocused = draft !== null;
    const local = draft ?? formatNumber(baseValue, 2);

    const isFloated = local !== "" || isFocused;

    function commit() {
        const parsed = parseFloat(local);
        if (!isNaN(parsed) && parsed !== baseValue) {
            onCommit(parsed);
        }
    }

    return (
        <div className="relative flex-1 min-w-0">
            <span
                className={`absolute pointer-events-none select-none transition-all duration-150 leading-none ${isFloated
                    ? `top-1 left-2 text-xs ${isFocused ? "text-accent" : "text-muted"}`
                    : "top-1/2 -translate-y-1/2 left-2 text-sm text-faint"
                    }`}
            >
                {label}
            </span>
            <input
                type="number"
                value={local}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => setDraft(formatNumber(baseValue, 2))}
                onBlur={() => {
                    setDraft(null);
                    commit();
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={`w-full rounded border bg-surface text-sm px-2 pt-4 pb-1 focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-fg ${isFocused ? "border-accent-hover" : "border-line-strong"
                    }`}
            />
        </div>
    );
}

export default function VertexPositionField() {
    const selectedObject = useCanvasSelectionStore((s) => s.selectedObject);
    const selectedVertexRefs = useCanvasSelectionStore((s) => s.selectedVertexRefs);
    const objects = useCanvasObjectStore((s) => s.objects);
    const moveVertexAt = useCanvasObjectStore((s) => s.moveVertexAt);
    const finalizeVertexMoveAt = useCanvasObjectStore((s) => s.finalizeVertexMoveAt);
    const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const xLabel = unitLabel(selectedUnit) ? `X (${unitLabel(selectedUnit)})` : "X";
    const yLabel = unitLabel(selectedUnit) ? `Y (${unitLabel(selectedUnit)})` : "Y";

    if (!selectedObject || selectedVertexRefs.length !== 1) return null;

    const vertexRef = selectedVertexRefs[0]!;
    if (!vertexRef || vertexRef.objectId !== selectedObject.id) return null;

    const liveObject = objects.find((obj) => obj.id === selectedObject.id);
    const liveVertex = liveObject?.vertices[vertexRef.index];
    if (!liveVertex) return null;

    const { x, y } = liveVertex;

    function commitX(newX: number) {
        moveVertexAt(vertexRef, { x: newX, y });
        finalizeVertexMoveAt(vertexRef);
    }

    function commitY(newY: number) {
        moveVertexAt(vertexRef, { x, y: newY });
        finalizeVertexMoveAt(vertexRef);
    }

    return (
        <div className="flex items-center gap-2 px-5 py-1">
            <span className="w-[30%] shrink-0 truncate text-sm text-fg">Position</span>
            <div className="flex-1 min-w-0 flex gap-1.5">
                <CoordInput label={xLabel} baseValue={x} unit={selectedUnit} onCommit={commitX} />
                <CoordInput label={yLabel} baseValue={y} unit={selectedUnit} onCommit={commitY} />
            </div>
        </div>
    );
}
