import { memo } from "react";
import FloatingControl from "@/components/floating-control/FloatingControl";
import { useCanvasHeatMapScaleFloatingControlStore } from "@/features/canvas-editing/stores/canvasHeatMapScaleFloatingControlStore";
import { useComputeResultStore } from "@/model/useComputeResultStore";

// Left → right: low visits to high visits
const STOP_RATIOS = [0.00, 0.25, 0.50, 0.75, 1.00] as const;

const GRADIENT = [
    "rgb(13,0,17) 0%",
    "rgb(81,18,124) 25%",
    "rgb(184,50,137) 50%",
    "rgb(251,135,97) 75%",
    "rgb(252,253,191) 100%",
].join(", ");

function stopLabel(t: number, maxCount: number): string {
    if (maxCount === 0) return "—";
    return String(Math.round(t * maxCount));
}

function CanvasHeatMapScaleFloatingControl() {
    const isOpen = useCanvasHeatMapScaleFloatingControlStore((s) => s.isOpen);
    const setOpen = useCanvasHeatMapScaleFloatingControlStore((s) => s.setOpen);
    const maxCount = useComputeResultStore((s) => s.coverageMetrics.maxCount);

    return (
        <FloatingControl
            id="heatmap-scale"
            title="Heat Map Scale"
            isOpen={isOpen}
            onClose={() => setOpen(false)}
            defaultPosition={{ x: 16, y: 16 }}
            hideHeader
        >
            <div className="px-3 pt-1 pb-2 flex flex-col gap-1">
                {/* Title above the bar */}
                <span className="text-[13px] font-medium text-gray-700 leading-tight select-none">
                    Ląstelės aplankymų skaičius
                </span>

                {/* Horizontal gradient bar */}
                <div
                    className="h-4 w-full rounded border border-gray-300"
                    style={{ background: `linear-gradient(to right, ${GRADIENT})` }}
                />

                {/* Values below — one per stop, evenly distributed */}
                <div className="flex justify-between">
                    {STOP_RATIOS.map((t) => (
                        <span
                            key={t}
                            className="text-[12px] font-medium text-gray-500 leading-none select-none tabular-nums"
                        >
                            {stopLabel(t, maxCount)}
                        </span>
                    ))}
                </div>
            </div>
        </FloatingControl>
    );
}

export default memo(CanvasHeatMapScaleFloatingControl);
