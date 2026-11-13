import { useEffect, useState } from "react";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useEnvStore } from "@/model/envStore";
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
    const [local, setLocal] = useState(formatNumber(baseValue, 2));
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
        if (!isFocused) setLocal(formatNumber(baseValue, 2));
    }, [baseValue, isFocused]);

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
                    ? `top-1 left-2 text-xs ${isFocused ? "text-teal-700" : "text-gray-500"}`
                    : "top-1/2 -translate-y-1/2 left-2 text-sm text-gray-400"
                    }`}
            >
                {label}
            </span>
            <input
                type="number"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => {
                    setIsFocused(false);
                    commit();
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={`w-full rounded border bg-white text-sm px-2 pt-4 pb-1 focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-gray-900 ${isFocused ? "border-teal-700" : "border-gray-300"
                    }`}
            />
        </div>
    );
}

export default function PointPositionField() {
    const selectedObject = useCanvasSelectionStore((s) => s.selectedObject);
    const selectedVertexRefs = useCanvasSelectionStore((s) => s.selectedVertexRefs);
    const selectedEnvPointType = useCanvasSelectionStore((s) => s.selectedEnvPointType);
    const startPoint = useEnvPointStore((s) => s.startPoint);
    const endPoint = useEnvPointStore((s) => s.endPoint);
    const startEndPoint = useEnvPointStore((s) => s.startEndPoint);
    const upsertPoint = useEnvPointStore((s) => s.upsertPoint);
    const objects = useCanvasObjectStore((s) => s.objects);
    const moveVertexAt = useCanvasObjectStore((s) => s.moveVertexAt);
    const finalizeVertexMoveAt = useCanvasObjectStore((s) => s.finalizeVertexMoveAt);
    const envId = useEnvStore((s) => s.env.id);
    const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const xLabel = unitLabel(selectedUnit) ? `X (${unitLabel(selectedUnit)})` : "X";
    const yLabel = unitLabel(selectedUnit) ? `Y (${unitLabel(selectedUnit)})` : "Y";

    if (selectedEnvPointType) {
        const envPointType = selectedEnvPointType;
        const currentPoint =
            envPointType === "start"
                ? startPoint
                : envPointType === "end"
                    ? endPoint
                    : startEndPoint;
        if (!currentPoint) return null;

        const { x, y } = currentPoint.point;

        function commitX(newX: number) {
            upsertPoint(envId, envPointType, { x: newX, y });
        }

        function commitY(newY: number) {
            upsertPoint(envId, envPointType, { x, y: newY });
        }

        return (
            <div className="flex items-center gap-2 px-5 py-1">
                <span className="w-[30%] shrink-0 truncate text-sm text-gray-800">Position</span>
                <div className="flex-1 min-w-0 flex gap-1.5">
                    <CoordInput label={xLabel} baseValue={x} unit={selectedUnit} onCommit={commitX} />
                    <CoordInput label={yLabel} baseValue={y} unit={selectedUnit} onCommit={commitY} />
                </div>
            </div>
        );
    }

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
            <span className="w-[30%] shrink-0 truncate text-sm text-gray-800">Position</span>
            <div className="flex-1 min-w-0 flex gap-1.5">
                <CoordInput label={xLabel} baseValue={x} unit={selectedUnit} onCommit={commitX} />
                <CoordInput label={yLabel} baseValue={y} unit={selectedUnit} onCommit={commitY} />
            </div>
        </div>
    );
}
