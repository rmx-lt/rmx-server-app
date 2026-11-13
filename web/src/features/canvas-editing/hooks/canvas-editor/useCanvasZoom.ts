import { useCallback } from "react";
import type Konva from "konva";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { ZOOM_MIN, ZOOM_MAX, ZOOM_FACTOR } from "@/config/canvas-editing/canvasConfig";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";

export function useCanvasZoom(
    stageRef: React.RefObject<Konva.Stage | null>,
    setScale: (scale: number) => void,
    setPosition: (pos: Point) => void,
) {
    const handleWheel = useCallback(
        (e: Konva.KonvaEventObject<WheelEvent>) => {
            if (!e.evt.altKey) return;
            e.evt.preventDefault();

            const stage = stageRef.current;
            if (!stage) return;
            const ptr = stage.getPointerPosition();
            if (!ptr) return;

            const { position: cur, scale: curScale } = useCanvasViewStore.getState();
            const direction = e.evt.deltaY > 0 ? -1 : 1;
            const newScale = Math.min(
                ZOOM_MAX,
                Math.max(ZOOM_MIN, curScale * Math.pow(ZOOM_FACTOR, direction)),
            );

            const mouseWorldX = (ptr.x - cur.x) / curScale;
            const mouseWorldY = (ptr.y - cur.y) / curScale;
            setScale(newScale);
            setPosition({
                x: ptr.x - mouseWorldX * newScale,
                y: ptr.y - mouseWorldY * newScale,
            });
        },
        [stageRef, setScale, setPosition],
    );

    return { handleWheel };
}
