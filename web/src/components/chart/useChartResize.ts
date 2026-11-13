import { useCallback, useRef, useState } from "react";
import type { Chart as ChartJS } from "chart.js";
import {
    DEFAULT_CHART_WIDTH,
    DEFAULT_CHART_HEIGHT,
    MODAL_CHROME_W,
    MIN_CHART_W,
    MIN_CHART_H,
    type ChartSize,
} from "@/components/chart/performanceMonitorModalStore";

interface UseChartResizeOptions {
    metricId: number;
    chartSizes: Record<number, ChartSize>;
    setChartSize: (metricId: number, width: number, height: number) => void;
    persistChartSizes: () => Promise<void>;
    chartRef: React.RefObject<ChartJS | null>;
    containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useChartResize({ metricId, chartSizes, setChartSize, persistChartSizes, chartRef, containerRef }: UseChartResizeOptions) {
    const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number; currentW: number; currentH: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleResizePointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const current = chartSizes[metricId] ?? { width: DEFAULT_CHART_WIDTH, height: DEFAULT_CHART_HEIGHT };
            dragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                startW: current.width,
                startH: current.height,
                currentW: current.width,
                currentH: current.height,
            };
            setIsDragging(true);

            const maxChartWidth = Math.floor(window.innerWidth * 0.9) - MODAL_CHROME_W;

            // Max width of all OTHER charts — used to mirror React's modal width formula during drag
            const otherMaxW = Math.max(
                DEFAULT_CHART_WIDTH,
                ...Object.entries(chartSizes)
                    .filter(([id]) => Number(id) !== metricId)
                    .map(([, s]) => s.width),
            );

            // Measure the modal's actual rendered size at drag start
            const modalEl = containerRef.current?.closest<HTMLElement>("[data-performance-modal]");
            const maxChartHeight = modalEl ? Math.floor(modalEl.clientHeight * 0.85) : 800;

            const onPointerMove = (event: PointerEvent) => {
                if (!dragRef.current) return;
                const containerLeft = containerRef.current?.getBoundingClientRect().left ?? 0;
                const containerTop = containerRef.current?.getBoundingClientRect().top ?? 0;
                const newW = Math.max(MIN_CHART_W, Math.min(maxChartWidth, event.clientX - containerLeft));
                const newH = Math.max(MIN_CHART_H, Math.min(maxChartHeight, event.clientY - containerTop));
                dragRef.current.currentW = newW;
                dragRef.current.currentH = newH;
                // Resize imperatively — no React state update, no re-render
                chartRef.current?.resize(newW, newH);
                if (containerRef.current) {
                    containerRef.current.style.width = `${newW}px`;
                    containerRef.current.style.height = `${newH}px`;
                }
                if (modalEl) {
                    // Mirror React formula: Math.max(DEFAULT_CHART_WIDTH, ...all widths) + MODAL_CHROME_W
                    modalEl.style.width = `${Math.max(otherMaxW, newW) + MODAL_CHROME_W}px`;
                }
            };

            const onPointerUp = () => {
                if (dragRef.current) {
                    setChartSize(metricId, dragRef.current.currentW, dragRef.current.currentH);
                }
                // Do NOT clear modalEl.style.width here — React will overwrite it on the
                // next render with its computed value. Clearing it first causes a one-frame
                // snap because the inline style disappears before React paints the new one.
                dragRef.current = null;
                setIsDragging(false);
                document.removeEventListener("pointermove", onPointerMove);
                document.removeEventListener("pointerup", onPointerUp);
                document.removeEventListener("pointercancel", onPointerUp);
                void persistChartSizes();
            };

            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", onPointerUp);
            document.addEventListener("pointercancel", onPointerUp);
        },
        [metricId, chartSizes, setChartSize, persistChartSizes, chartRef, containerRef],
    );

    return { handleResizePointerDown, isDragging };
}
