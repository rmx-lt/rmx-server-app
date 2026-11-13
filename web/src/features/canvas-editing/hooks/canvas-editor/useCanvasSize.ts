import { useEffect, useRef, useState } from "react";

export function useCanvasSize() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            setSize({ width, height });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return { containerRef, size };
}
