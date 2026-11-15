import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import type { ActiveTool } from "@/features/canvas-editing/types/canvas";
import { ZONE_CATEGORY, type ZoneCategory } from "@/config/db-ops/enums";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";

interface UseCanvasDrawingOptions {
    activeTool: ActiveTool | null;
    stageRef: React.RefObject<Konva.Stage | null>;
    clearSelection: () => void;
    addObject: (
        category: ZoneCategory,
        points: Point[],
    ) => void;
}

export function useCanvasDrawing({
    activeTool,
    stageRef,
    clearSelection,
    addObject,
}: UseCanvasDrawingOptions) {
    const {
        drawingPoints,
        mousePos,
        appendDrawingPoint,
        setMousePos,
        setPointerPos,
        cancelDrawing,
    } = useCanvasDrawingStore();

    // RAF throttle — only write positions to Zustand once per display frame
    const pendingMousePosRef = useRef<Point | null>(null);
    const pendingPointerPosRef = useRef<Point | null>(null);
    const rafIdRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
        };
    }, []);

    const flushMousePos = useCallback(() => {
        if (pendingPointerPosRef.current) {
            setPointerPos(pendingPointerPosRef.current);
            pendingPointerPosRef.current = null;
        }
        if (pendingMousePosRef.current) {
            setMousePos(pendingMousePosRef.current);
            pendingMousePosRef.current = null;
        }
        rafIdRef.current = null;
    }, [setMousePos, setPointerPos]);

    const updateDrawingMousePosition = useCallback(
        () => {
            const stage = stageRef.current;
            if (!stage) return;
            const ptr = stage.getRelativePointerPosition();
            if (!ptr) return;
            pendingPointerPosRef.current = { x: ptr.x, y: ptr.y };
            if (activeTool === "addMowingZone" || activeTool === "addNoGoZone") {
                pendingMousePosRef.current = { x: ptr.x, y: ptr.y };
            }
            if (rafIdRef.current === null) {
                rafIdRef.current = requestAnimationFrame(flushMousePos);
            }
        },
        [activeTool, stageRef, flushMousePos],
    );

    const clearDrawingMousePosition = useCallback(() => {
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
        pendingMousePosRef.current = null;
        pendingPointerPosRef.current = null;
        setMousePos(null);
        setPointerPos(null);
    }, [setMousePos, setPointerPos]);

    const handleStageClick = useCallback(
        (e: Konva.KonvaEventObject<MouseEvent>) => {
            if (e.evt.button !== 0) return;

            if (activeTool === "addMowingZone" || activeTool === "addNoGoZone") {
                const stage = stageRef.current;
                if (!stage) return;
                if (e.target !== stage) return;
                const ptr = stage.getRelativePointerPosition();
                if (!ptr) return;
                appendDrawingPoint({ x: ptr.x, y: ptr.y });
                return;
            }

            if (activeTool === "select" && e.target === stageRef.current) {
                clearSelection();
            }
        },
        [activeTool, stageRef, clearSelection, appendDrawingPoint],
    );

    const handlePolygonClose = useCallback(
        (e: Konva.KonvaEventObject<PointerEvent>) => {
            e.evt.preventDefault();
            if (
                (activeTool === "addMowingZone" || activeTool === "addNoGoZone") &&
                drawingPoints.length >= 3
            ) {
                addObject(
                    activeTool === "addMowingZone" ? ZONE_CATEGORY.MOWING : ZONE_CATEGORY.NO_GO,
                    drawingPoints,
                );
                cancelDrawing();
            }
        },
        [activeTool, drawingPoints, addObject, cancelDrawing],
    );

    return {
        drawingPoints,
        mousePos,
        updateDrawingMousePosition,
        clearDrawingMousePosition,
        handleStageClick,
        handlePolygonClose,
        cancelDrawing,
    };
}
