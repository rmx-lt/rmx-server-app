import { useCallback, useRef, useState } from "react";
import type React from "react";
import type Konva from "konva";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";

/**
 * Middle-mouse-button canvas panning.
 *
 * Uses Konva built-in drag machinery (option 2 from Konva scrolling docs):
 * - stage.startDrag() on middle-mouse-down hands control to Konva DD engine
 * - Konva updates stage x/y and redraws on every mousemove frame natively
 * - onDragMove syncs position to Zustand so CanvasGridLayer (CSS div) updates
 * - onDragEnd does final sync and cleanup
 *
 * No manual RAF, no CSS transforms, no manual position arithmetic.
 */
export function useCanvasPanning(
    stageRef: React.RefObject<Konva.Stage | null>,
    setPosition: (pos: Point) => void,
) {
    const isPanningRef = useRef(false);
    const [isPanning, setIsPanning] = useState(false);

    // Middle-mouse down: hand control to Konva's drag engine
    const handlePanMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.evt.button === 1) {
            e.evt.preventDefault();
            const stage = stageRef.current;
            if (!stage) return;
            isPanningRef.current = true;
            setIsPanning(true);
            stage.startDrag();
        }
    }, [stageRef]);

    // Konva fires dragmove every frame it moves the stage - sync to Zustand for grid
    const handleDragMove = useCallback(() => {
        if (!isPanningRef.current) return;
        const stage = stageRef.current;
        if (stage) setPosition({ x: stage.x(), y: stage.y() });
    }, [stageRef, setPosition]);

    // Konva fires dragend when mouse is released - final sync and cleanup
    const handleDragEnd = useCallback(() => {
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        setIsPanning(false);
        const stage = stageRef.current;
        if (stage) setPosition({ x: stage.x(), y: stage.y() });
    }, [stageRef, setPosition]);

    return {
        isPanning,
        isPanningRef,
        handlePanMouseDown,
        handleDragMove,
        handleDragEnd,
    };
}