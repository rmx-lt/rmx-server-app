import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";

export default function CanvasZoomLevel() {
    const scale = useCanvasViewStore((s) => s.scale);

    return (
        <div className="flex items-center gap-1 h-5 px-1.5 text-xs text-muted select-none tabular-nums min-w-12 justify-end">
            <span className="material-symbols-outlined text-faint shrink-0" style={{ fontSize: 14 }}>
                zoom_in
            </span>
            <span>{Math.round(scale * 100)}%</span>
        </div>
    );
}
