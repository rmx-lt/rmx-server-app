import CanvasEditor from "@/features/canvas-editing/components/canvas-editor/CanvasEditor";
import CanvasViewControls from "@/features/canvas-editing/components/tool-strip/CanvasViewControls";
import CanvasMapControls from "./CanvasMapControls";
import CanvasTools from "./CanvasTools";

/** The canvas fills the middle; the tools and the view controls float over it. */
export default function CanvasArea() {
    return (
        <main className="relative min-h-0 flex-1 overflow-hidden">
            <CanvasEditor />
            <CanvasTools />
            <CanvasViewControls />
            <CanvasMapControls />
        </main>
    );
}
