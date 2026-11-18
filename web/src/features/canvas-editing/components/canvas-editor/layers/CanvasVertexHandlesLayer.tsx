import { memo, useState } from "react";
import { Layer, Circle, Rect } from "react-konva";
import type { ActiveTool, VertexRef } from "@/features/canvas-editing/types/canvas";
import type { Area } from "@/data/planning/schemaTypes";
import { computeEdgeMidpoints, type Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { sameVertexRef } from "@/features/canvas-editing/utils/canvasObjectUtils";
import { useCanvasColors } from "@/hooks/useTheme";
import { AREA_CATEGORY, type AreaCategory } from "@/config/db-ops/enums";

interface CanvasVertexHandlesLayerProps {
    selectedObject: Area | null;
    selectedObjectVertices: Array<{ x: number; y: number }>;
    activeTool: ActiveTool | null;
    scale: number;
    selectedVertexRefs: VertexRef[];
    draggingVertexRef: VertexRef | null;
    onVertexClick: (ref: VertexRef, ctrl: boolean) => void;
    onVertexDragStart: (ref: VertexRef) => void;
    onVertexDragMove: (ref: VertexRef, pos: Point) => void;
    onVertexDragEnd: (ref: VertexRef, pos: Point) => void;
    onEdgeMidpointMouseDown: (objectId: number, afterIndex: number, mid: Point) => void;
    onHandleHoverChange: (hovered: boolean) => void;
}

export function CanvasVertexHandlesLayerInner({
    selectedObject,
    selectedObjectVertices,
    activeTool,
    scale,
    selectedVertexRefs,
    draggingVertexRef,
    onVertexClick,
    onVertexDragStart,
    onVertexDragMove,
    onVertexDragEnd,
    onEdgeMidpointMouseDown,
    onHandleHoverChange,
}: CanvasVertexHandlesLayerProps) {
    const category = (selectedObject?.category ?? AREA_CATEGORY.MOWING) as AreaCategory;
    const colors = useCanvasColors();
    const [hover, setHover] = useState<{ kind: "vertex" | "mid"; index: number } | null>(null);
    const accentColor = colors[category].stroke;
    const isLayerListening = activeTool === "select" && selectedObject !== null;
    const edgeMidpoints = selectedObject ? computeEdgeMidpoints(selectedObjectVertices) : [];
    if (!selectedObject) return <Layer />;
    // Sizes are screen pixels divided by the zoom, so they stay constant on screen.
    const half = 2.5 / scale; // half the side of the square
    const ringRadius = 6 / scale;
    const ringWidth = 1.5 / scale;
    const ringWidthSelected = 2 / scale;
    const midRadius = 4 / scale;
    const midWidth = 1 / scale;
    const midNear = 14 / scale; // a cursor this close shows the midpoint ring
    const midGrab = 8 / scale; // only a press this close drags (SolidCraft's point reach)
    const vertexGrab = 8 / scale;

    const enter = (kind: "vertex" | "mid", index: number) => () => {
        setHover({ kind, index });
        onHandleHoverChange(true);
    };
    const leave = () => {
        setHover(null);
        onHandleHoverChange(false);
    };

    return (
        <Layer listening={isLayerListening}>
            {/* Midpoints first, so a vertex stays on top where they overlap. */}
            {selectedObjectVertices.map((_, i) => {
                const mid = edgeMidpoints[i];
                if (!mid) return null;
                const near = hover?.kind === "mid" && hover.index === i;
                return [
                    <Circle
                        key={`edge-midpoint-hit-${i}`}
                        x={mid.x}
                        y={mid.y}
                        radius={midNear}
                        fill="transparent"
                        onMouseDown={(e) => {
                            if (e.evt.button !== 0) return;
                            const ptr = e.target.getStage()?.getRelativePointerPosition();
                            if (!ptr || Math.hypot(ptr.x - mid.x, ptr.y - mid.y) > midGrab) return;
                            e.cancelBubble = true;
                            // The insert shifts the edge indexes: without this the next edge's ring flashes.
                            setHover(null);
                            onEdgeMidpointMouseDown(selectedObject.id, i, mid);
                        }}
                        onMouseEnter={enter("mid", i)}
                        onMouseLeave={leave}
                    />,
                    near && (
                        <Circle
                            key={`edge-midpoint-ring-${i}`}
                            x={mid.x}
                            y={mid.y}
                            radius={midRadius}
                            stroke={accentColor}
                            strokeWidth={midWidth}
                            listening={false}
                        />
                    ),
                ];
            })}
            {selectedObjectVertices.map((v, i) => {
                const ref: VertexRef = { objectId: selectedObject.id, index: i };
                const isSelected =
                    selectedVertexRefs.some((sv) => sameVertexRef(sv, ref)) ||
                    (draggingVertexRef !== null && sameVertexRef(draggingVertexRef, ref));
                const isHovered = hover?.kind === "vertex" && hover.index === i;
                // The ring has the area colour; selected differs from hover by its width.
                const ring = isHovered || isSelected ? accentColor : null;
                return [
                    ring && (
                        <Circle
                            key={`vertex-ring-${i}`}
                            x={v.x}
                            y={v.y}
                            radius={ringRadius}
                            stroke={ring}
                            strokeWidth={isSelected ? ringWidthSelected : ringWidth}
                            listening={false}
                        />
                    ),
                    <Rect
                        key={`vertex-handle-${i}`}
                        x={v.x}
                        y={v.y}
                        offsetX={half}
                        offsetY={half}
                        width={half * 2}
                        height={half * 2}
                        fill={accentColor}
                        stroke={accentColor}
                        strokeWidth={1 / scale}
                        // Grab area: a circle around the vertex (local origin is the square's corner).
                        hitFunc={(ctx, shape) => {
                            ctx.beginPath();
                            ctx.arc(half, half, vertexGrab, 0, Math.PI * 2);
                            ctx.fillStrokeShape(shape);
                        }}
                        draggable
                        onClick={(e) => {
                            e.cancelBubble = true;
                            onVertexClick(ref, e.evt.ctrlKey || e.evt.metaKey);
                        }}
                        onDragStart={() => onVertexDragStart(ref)}
                        onDragMove={(e) => onVertexDragMove(ref, { x: e.target.x(), y: e.target.y() })}
                        onDragEnd={(e) => onVertexDragEnd(ref, { x: e.target.x(), y: e.target.y() })}
                        onMouseEnter={enter("vertex", i)}
                        onMouseLeave={leave}
                    />,
                ];
            })}
        </Layer>
    );
}

export const CanvasVertexHandlesLayer = memo(CanvasVertexHandlesLayerInner);
