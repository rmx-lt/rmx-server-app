import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";

export default function AddEndPointButton() {
    const { activeTool, setActiveTool } = useCanvasToolStore();
    const cancelDrawing = useCanvasDrawingStore((s) => s.cancelDrawing);
    const isActive = activeTool === "addEndPoint";

    return (
        <ToolBarButton
            title="Add End Point"
            icon="flag"
            isActive={isActive}
            onClick={() => {
                cancelDrawing();
                setActiveTool(isActive ? null : "addEndPoint");
            }}
        />
    );
}
