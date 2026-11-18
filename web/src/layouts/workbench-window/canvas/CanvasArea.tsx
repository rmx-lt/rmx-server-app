import CanvasEditor from "@/features/canvas-editing/components/canvas-editor/CanvasEditor";
import CanvasViewControls from "@/features/canvas-editing/components/tool-strip/CanvasViewControls";
import CanvasMapControls from "./CanvasMapControls";
import CanvasTools from "./CanvasTools";

/** The canvas fills the middle; the tools and the view controls float over it. */
export default function CanvasArea() {
    return (
        <main className="relative min-h-0 flex-1 overflow-hidden">
            <CanvasEditor />
            {/* The controls are 24px from the bottom and from the sides of the canvas (this inset plus their own bottom-4 / left-3 / right-3), which clears the map attribution strip (about 19px) by a few pixels; the same on Grid, so they do not jump. */}
            <div className="pointer-events-none absolute inset-x-3 top-0 bottom-2">
                <CanvasTools />
                <CanvasViewControls />
                <CanvasMapControls />
            </div>
        </main>
    );
}
