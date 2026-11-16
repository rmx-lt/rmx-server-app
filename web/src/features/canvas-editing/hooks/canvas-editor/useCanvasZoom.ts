import { useCallback } from "react";
import type Konva from "konva";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { ZOOM_FACTOR } from "@/config/canvas-editing/canvasConfig";

/** Alt + wheel zooms, animated, anchored on the cursor. */
export function useCanvasZoom(stageRef: React.RefObject<Konva.Stage | null>) {
    const handleWheel = useCallback(
        (e: Konva.KonvaEventObject<WheelEvent>) => {
            if (!e.evt.altKey) return;
            e.evt.preventDefault();
            const ptr = stageRef.current?.getPointerPosition();
            if (!ptr) return;
            useCanvasViewStore.getState().zoomBy(Math.pow(ZOOM_FACTOR, e.evt.deltaY > 0 ? -1 : 1), ptr);
        },
        [stageRef],
    );

    return { handleWheel };
}
