import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import type Konva from "konva";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";

export function useCanvasSize(stageRef: RefObject<Konva.Stage | null>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        let left = el.getBoundingClientRect().left;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            // The origin is the canvas's left edge: when a left panel moves it, the view is shifted back so what is on screen stays put.
            const newLeft = el.getBoundingClientRect().left;
            const shift = left - newLeft;
            left = newLeft;
            // The observer runs after layout, just before paint: commit React and draw the stage synchronously so the canvas edge and the view correction land in the same painted frame (batched redraws would paint one frame late).
            flushSync(() => {
                const { position, setPosition, setCanvasSize } = useCanvasViewStore.getState();
                if (shift !== 0) setPosition({ x: position.x + shift, y: position.y });
                setCanvasSize(width, height);
                setSize({ width, height });
            });
            stageRef.current?.draw();
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [stageRef]);

    return { containerRef, size };
}
