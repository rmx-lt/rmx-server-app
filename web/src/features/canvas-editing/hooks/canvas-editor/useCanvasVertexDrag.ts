import { useCallback } from "react";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { useRAFThrottle } from "@/hooks/useRAFThrottle";

/**
 * Throttles vertex position updates during Konva drag to one Zustand write
 * per animation frame (~60fps instead of every mousemove event).
 */
export function useCanvasVertexDrag(
    moveVertexAt: (ref: VertexRef, pos: Point) => void,
    finalizeVertexMoveAt: (ref: VertexRef) => void,
) {
    const { schedule, cancel } = useRAFThrottle<{ ref: VertexRef; pos: Point }>(
        ({ ref, pos }) => moveVertexAt(ref, pos),
    );

    /** Called on every Konva onDragMove — accumulates, schedules at most one RAF/frame. */
    const handleVertexDragMove = useCallback(
        (ref: VertexRef, pos: Point) => schedule({ ref, pos }),
        [schedule],
    );

    /** Called on Konva onDragEnd — commits final position then syncs once. */
    const handleVertexDragEnd = useCallback(
        (ref: VertexRef, pos: Point) => {
            cancel();
            moveVertexAt(ref, pos);
            finalizeVertexMoveAt(ref);
        },
        [cancel, moveVertexAt, finalizeVertexMoveAt],
    );

    return { handleVertexDragMove, handleVertexDragEnd };
}
