import { useCallback, useRef, useState } from "react";
import type Konva from "konva";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { beginBatch, endBatch } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useRAFThrottle } from "@/hooks/useRAFThrottle";

interface UseCanvasMidpointDragOptions {
    stageRef: React.RefObject<Konva.Stage | null>;
    insertVertex: (objectId: number, afterIndex: number, pos: Point) => VertexRef;
    moveVertexAt: (ref: VertexRef, pos: Point) => void;
    finalizeVertexMoveAt: (ref: VertexRef) => void;
    selectVertex: (ref: VertexRef | null) => void;
}

export function useCanvasMidpointDrag({
    stageRef,
    insertVertex,
    moveVertexAt,
    finalizeVertexMoveAt,
    selectVertex,
}: UseCanvasMidpointDragOptions) {
    const [midpointDragState, setMidpointDragState] = useState<VertexRef | null>(null);
    const dragStateRef = useRef<VertexRef | null>(null);

    const { schedule, flush } = useRAFThrottle<Point>((pos) => {
        if (dragStateRef.current) moveVertexAt(dragStateRef.current, pos);
    });

    const handleMidpointMouseDown = useCallback(
        (objectId: number, afterIndex: number, mid: Point) => {
            beginBatch();
            const newRef = insertVertex(objectId, afterIndex, mid);
            selectVertex(newRef);
            dragStateRef.current = newRef;
            setMidpointDragState(newRef);
        },
        [insertVertex, selectVertex],
    );

    const handleMidpointDragMouseMove = useCallback(
        () => {
            if (!dragStateRef.current) return;
            const stage = stageRef.current;
            if (!stage) return;
            const ptr = stage.getRelativePointerPosition();
            if (!ptr) return;
            schedule({ x: ptr.x, y: ptr.y });
        },
        [stageRef, schedule],
    );

    const handleMidpointDragEnd = useCallback(() => {
        if (!dragStateRef.current) return;
        flush();
        finalizeVertexMoveAt(dragStateRef.current);
        dragStateRef.current = null;
        setMidpointDragState(null);
        selectVertex(null);
        endBatch();
    }, [flush, finalizeVertexMoveAt, selectVertex]);

    return {
        isMidpointDragging: midpointDragState !== null,
        handleMidpointMouseDown,
        handleMidpointDragMouseMove,
        handleMidpointDragEnd,
    };
}
