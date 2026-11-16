import { useEffect, useRef, useState } from "react";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";

export function useCanvasSize() {
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
            if (newLeft !== left) {
                const { position, setPosition } = useCanvasViewStore.getState();
                setPosition({ x: position.x + left - newLeft, y: position.y });
                left = newLeft;
            }
            setSize({ width, height });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return { containerRef, size };
}
