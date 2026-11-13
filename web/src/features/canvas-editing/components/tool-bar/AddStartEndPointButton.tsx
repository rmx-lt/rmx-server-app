import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";

export default function AddStartEndPointButton() {
    const { activeTool, setActiveTool } = useCanvasToolStore();
    const cancelDrawing = useCanvasDrawingStore((s) => s.cancelDrawing);
    const isActive = activeTool === "addStartEndPoint";

    return (
        <ToolBarButton
            title="Add Start & End Point"
            icon="loop"
            isActive={isActive}
            onClick={() => {
                cancelDrawing();
                setActiveTool(isActive ? null : "addStartEndPoint");
            }}
        />
    );
}
