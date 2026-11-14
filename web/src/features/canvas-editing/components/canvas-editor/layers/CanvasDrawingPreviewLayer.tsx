import { Layer, Line, Circle } from "react-konva";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import type { ActiveTool } from "@/features/canvas-editing/types/canvas";
import { useLayerSettingsStore, getLayerParam } from "@/model/layerSettingsStore";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";

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
    const layers = useLayerSettingsStore((s) => s.layers);
    const isDrawing = activeTool === "addZone" || activeTool === "addObstacle";

    if (!isDrawing || drawingPoints.length === 0) return null;

    const drawLayerId = activeTool === "addZone" ? LAYER_ID.ZONES : LAYER_ID.OBSTACLES;
    const drawColor = drawLayerId === LAYER_ID.ZONES
        ? (getLayerParam(layers, LAYER_ID.ZONES, LAYER_PARAM_KEY.POLYGON_EDGE_COLOR) ?? "#22c55e")
        : (getLayerParam(layers, LAYER_ID.OBSTACLES, LAYER_PARAM_KEY.POLYGON_EDGE_COLOR) ?? "#ef4444");
    const previewEdgeColor = drawColor;
    const drawEdgeWidth = parseFloat(getLayerParam(layers, drawLayerId, LAYER_PARAM_KEY.POLYGON_EDGE_WIDTH) ?? "1.5");
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
