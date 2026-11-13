import ToolBarButton from "@/components/tool-bar/ToolBarButton";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasDrawingStore } from "@/features/canvas-editing/stores/canvasDrawingStore";

export default function AddStartPointButton() {
    const { activeTool, setActiveTool } = useCanvasToolStore();
    const cancelDrawing = useCanvasDrawingStore((s) => s.cancelDrawing);
    const isActive = activeTool === "addStartPoint";

    return (
        <ToolBarButton
            title="Add Start Point"
            icon="trip_origin"
            isActive={isActive}
            onClick={() => {
                cancelDrawing();
                setActiveTool(isActive ? null : "addStartPoint");
            }}
        />
    );
}
