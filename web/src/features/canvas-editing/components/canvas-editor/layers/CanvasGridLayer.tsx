import { memo } from "react";
import { Layer, Line, Rect } from "react-konva";
import { GRID_MAJOR_EVERY, GRID_SPACING, pickGridLevel } from "@/config/canvas-editing/canvasConfig";
import { useCanvasColors } from "@/hooks/useTheme";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";

/** Minor lines are fainter than the major line every GRID_MAJOR_EVERY cells. */
const MINOR_OPACITY = 0.45;

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
    const strokeColor = useCanvasColors().grid;
    const position = useCanvasViewStore((s) => s.position);
    const scale = useCanvasViewStore((s) => s.scale);

    const level = pickGridLevel(scale);
    const cellWorld = GRID_SPACING * level;
    const sw = 1 / scale;

    // Viewport bounds in world coordinates
    const minX = -position.x / scale;
    const maxX = (-position.x + width) / scale;
    const minY = -position.y / scale;
    const maxY = (-position.y + height) / scale;

    // Index-based so fractional cell sizes do not accumulate rounding errors.
    const i0 = Math.floor(minX / cellWorld);
    const i1 = Math.ceil(maxX / cellWorld);
    const j0 = Math.floor(minY / cellWorld);
    const j1 = Math.ceil(maxY / cellWorld);
    const lineProps = (i: number) => ({
        stroke: strokeColor,
        strokeWidth: sw,
        opacity: i % GRID_MAJOR_EVERY === 0 ? 1 : MINOR_OPACITY,
        perfectDrawEnabled: false,
    });

    const vLines: number[] = [];
    for (let i = i0; i <= i1; i++) vLines.push(i);
    const hLines: number[] = [];
    for (let j = j0; j <= j1; j++) hLines.push(j);

    const w = maxX - minX;
    const h = maxY - minY;

    return (
        <Layer listening={false}>
            {vLines.map((i) => (
                <Line key={i} points={[i * cellWorld, minY, i * cellWorld, maxY]} {...lineProps(i)} />
            ))}
            {hLines.map((j) => (
                <Line key={j} points={[minX, j * cellWorld, maxX, j * cellWorld]} {...lineProps(j)} />
            ))}
            {/* Erases the grid towards the edges: transparent in the middle, opaque at the corners. */}
            <Rect
                x={minX}
                y={minY}
                width={w}
                height={h}
                globalCompositeOperation="destination-out"
                fillRadialGradientStartPoint={{ x: w / 2, y: h / 2 }}
                fillRadialGradientEndPoint={{ x: w / 2, y: h / 2 }}
                fillRadialGradientStartRadius={0}
                fillRadialGradientEndRadius={Math.hypot(w, h) / 2}
                fillRadialGradientColorStops={[0, "rgba(0,0,0,0)", 0.45, "rgba(0,0,0,0)", 0.85, "rgba(0,0,0,1)"]}
            />
        </Layer>
    );
}

export const CanvasGridLayer = memo(CanvasGridLayerInner);
