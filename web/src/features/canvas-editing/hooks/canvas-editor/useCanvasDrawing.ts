import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import type { ActiveTool } from "@/features/canvas-editing/types/canvas";
import { OBJECT_CATEGORY, defaultObjectTypeForEnv, type ObjectCategory, type ObjectType } from "@/config/db-ops/enums";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";
import { useEnvStore } from "@/model/envStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

interface UseCanvasDrawingOptions {
    activeTool: ActiveTool | null;
    stageRef: React.RefObject<Konva.Stage | null>;
    clearSelection: () => void;
    addObject: (
        category: ObjectCategory,
        points: Point[],
        type: ObjectType,
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
            if (activeTool === "addZone" || activeTool === "addObstacle") {
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

            if (activeTool === "addStartPoint" || activeTool === "addEndPoint" || activeTool === "addStartEndPoint") {
                const stage = stageRef.current;
                if (!stage) return;
                if (e.target !== stage) return;
                const ptr = stage.getRelativePointerPosition();
                if (!ptr) return;
                const type = activeTool === "addStartPoint" ? "start" : activeTool === "addEndPoint" ? "end" : "start_end";
                const environmentId = useEnvStore.getState().env.id;
                const { startPoint, endPoint, startEndPoint, upsertPoint } = useEnvPointStore.getState();

                let conflictMessage: string | null = null;
                if (type === "start_end") {
                    if (startPoint && endPoint) {
                        conflictMessage = "A start and end point already exist. Continuing will remove them.";
                    } else if (startPoint) {
                        conflictMessage = "A start point already exists. Continuing will remove it.";
                    } else if (endPoint) {
                        conflictMessage = "An end point already exists. Continuing will remove it.";
                    }
                } else if (startEndPoint) {
                    conflictMessage = "A Start & End point already exists. Continuing will remove it.";
                }

                const doPlace = async () => {
                    await upsertPoint(environmentId, type, { x: ptr.x, y: ptr.y });
                    useCanvasToolStore.getState().setActiveTool(null);
                };

                if (conflictMessage) {
                    useConfirmationModalStore.getState().requestConfirmation({
                        title: "Point type already in use",
                        message: conflictMessage,
                        tone: "warning",
                        confirmLabel: "Continue",
                        confirmAction: doPlace,
                    });
                } else {
                    doPlace();
                }
                return;
            }

            if (activeTool === "addZone" || activeTool === "addObstacle") {
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
                (activeTool === "addZone" || activeTool === "addObstacle") &&
                drawingPoints.length >= 3
            ) {
                const objectType = defaultObjectTypeForEnv(useEnvStore.getState().env.type);
                addObject(
                    activeTool === "addZone" ? OBJECT_CATEGORY.ZONE : OBJECT_CATEGORY.OBSTACLE,
                    drawingPoints,
                    objectType,
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
