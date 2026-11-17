import CanvasEditor from "@/features/canvas-editing/components/canvas-editor/CanvasEditor";
import CanvasViewControls from "@/features/canvas-editing/components/tool-strip/CanvasViewControls";
import CanvasMapControls from "./CanvasMapControls";
import CanvasTools from "./CanvasTools";

/** The canvas fills the middle; the tools and the view controls float over it. */
export default function CanvasArea() {
    return (
        <main className="relative min-h-0 flex-1 overflow-hidden">
            <CanvasEditor />
            {/* Keeps the controls above the map attribution strip (also on Empty, so they do not jump). */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bottom-4">
                <CanvasTools />
                <CanvasViewControls />
                <CanvasMapControls />
            </div>
        </main>
    );
}
