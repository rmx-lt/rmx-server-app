import { House, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import type { ComponentType } from "react";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { fitView } from "@/features/canvas-editing/data/canvasActions";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";

function ViewButton({ label, icon: Icon, onClick }: { label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-fg transition-colors hover:bg-hover"
        >
            <Icon size={16} strokeWidth={1.75} />
        </button>
    );
}

/** Zoom, fit and home, in the bottom right corner of the canvas (every mode). */
export default function CanvasViewControls() {
    const zoomIn = useCanvasViewStore((s) => s.zoomIn);
    const zoomOut = useCanvasViewStore((s) => s.zoomOut);
    const resetView = useCanvasViewStore((s) => s.resetView);
    return (
        <div role="group" aria-label="View" className="pointer-events-auto absolute bottom-4 max-md:bottom-20 right-3 flex flex-col rounded-xl border border-line bg-surface p-1 shadow-lg">
            <ViewButton label="Zoom in" icon={ZoomIn} onClick={zoomIn} />
            <ViewButton label="Zoom out" icon={ZoomOut} onClick={zoomOut} />
            <ViewButton label="Fit all zones" icon={Maximize} onClick={fitView} />
            <ViewButton label={`Home (${S["canvas.reset-view"].shortcut.join("+")})`} icon={House} onClick={resetView} />
        </div>
    );
}
