import { memo } from "react";
import { Layer, Line } from "react-konva";
import { GRID_SPACING, pickGridLevel } from "@/config/canvas-editing/canvasConfig";
import { useLayerSettingsStore, getLayerParam } from "@/model/layerSettingsStore";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";

interface CanvasGridLayerProps {
    width: number;
    height: number;
}

/**
 * Renders the canvas grid as a Konva Layer using world-coordinate lines.
 * The Stage transform (pan + zoom) positions lines automatically — no
 * counter-transform needed.
 *
 * Only lines visible in the current viewport are drawn, so line count stays
 * constant regardless of world size. The adaptive grid level keeps cell size
 * in a readable pixel range at any zoom.
 *
 * strokeWidth={1/scale} keeps lines at exactly 1 CSS pixel regardless of zoom.
 */
function CanvasGridLayerInner({ width, height }: CanvasGridLayerProps) {
    const layers = useLayerSettingsStore((s) => s.layers);
    const gridVisible = getLayerParam(layers, LAYER_ID.GRID, LAYER_PARAM_KEY.VISIBLE) !== "false";
    const strokeColor = getLayerParam(layers, LAYER_ID.GRID, LAYER_PARAM_KEY.GRID_LINE_COLOR) ?? "#e2e8f0";
    const position = useCanvasViewStore((s) => s.position);
    const scale = useCanvasViewStore((s) => s.scale);

    if (!gridVisible) return null;

    const level = pickGridLevel(scale);
    const cellWorld = GRID_SPACING * level;
    const sw = 1 / scale;

    // Viewport bounds in world coordinates
    const minX = -position.x / scale;
    const maxX = (-position.x + width) / scale;
    const minY = -position.y / scale;
    const maxY = (-position.y + height) / scale;

    const firstVX = Math.floor(minX / cellWorld) * cellWorld;
    const firstHY = Math.floor(minY / cellWorld) * cellWorld;

    const vLines: number[] = [];
    for (let x = firstVX; x <= maxX + cellWorld; x += cellWorld) vLines.push(x);

    const hLines: number[] = [];
    for (let y = firstHY; y <= maxY + cellWorld; y += cellWorld) hLines.push(y);

    return (
        <Layer listening={false}>
            {vLines.map((x) => (
                <Line
                    key={x}
                    points={[x, minY, x, maxY]}
                    stroke={strokeColor}
                    strokeWidth={sw}
                    perfectDrawEnabled={false}
                />
            ))}
            {hLines.map((y) => (
                <Line
                    key={y}
                    points={[minX, y, maxX, y]}
                    stroke={strokeColor}
                    strokeWidth={sw}
                    perfectDrawEnabled={false}
                />
            ))}
        </Layer>
    );
}

export const CanvasGridLayer = memo(CanvasGridLayerInner);
