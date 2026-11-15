import { Layer, Line, Circle } from "react-konva";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import type { ActiveTool } from "@/features/canvas-editing/types/canvas";
import { LAYER_STYLE } from "@/config/canvas-editing/canvasConfig";
import { useCanvasColors } from "@/hooks/useTheme";

interface CanvasDrawingPreviewLayerProps {
    activeTool: ActiveTool | null;
    drawingPoints: Point[];
    mousePos: Point | null;
    scale: number;
}

export function CanvasDrawingPreviewLayer({
    activeTool,
    drawingPoints,
    mousePos,
    scale,
}: CanvasDrawingPreviewLayerProps) {
    const colors = useCanvasColors();
    const isDrawing = activeTool === "addMowingZone" || activeTool === "addNoGoZone";

    if (!isDrawing || drawingPoints.length === 0) return null;

    const category = activeTool === "addMowingZone" ? "mowing" : "no_go";
    const drawColor = colors[category].stroke;
    const drawEdgeWidth = LAYER_STYLE[category].edgeWidth;
    const previewEdgeColor = drawColor;
    const previewDotRadius = Math.max(4, drawEdgeWidth) / scale;
    const previewStrokeWidth = Math.max(2, drawEdgeWidth) / scale;
    const lastPoint = drawingPoints[drawingPoints.length - 1];

    return (
        <Layer listening={false}>
            <Line
                points={drawingPoints.flatMap((p) => [p.x, p.y])}
                stroke={drawColor}
                strokeWidth={previewStrokeWidth}
                closed={false}
                dash={[6 / scale, 3 / scale]}
            />
            {mousePos && lastPoint && (
                <Line
                    points={[lastPoint.x, lastPoint.y, mousePos.x, mousePos.y]}
                    stroke={previewEdgeColor}
                    strokeWidth={previewStrokeWidth * 0.75}
                    dash={[4 / scale, 4 / scale]}
                />
            )}
            {drawingPoints.map((p, idx) => (
                <Circle
                    key={`drawing-preview-point-${idx}`}
                    x={p.x}
                    y={p.y}
                    radius={previewDotRadius}
                    fill={drawColor}
                />
            ))}
        </Layer>
    );
}
