import { memo } from "react";
import { Layer, Circle } from "react-konva";
import { CanvasVertexIdLabel } from "@/features/canvas-editing/components/canvas-editor/shapes/CanvasVertexIdLabel";
import type { ActiveTool, VertexRef } from "@/features/canvas-editing/types/canvas";
import type { Object } from "@/data/local/schemaTypes";
import { computeEdgeMidpoints, type Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { sameVertexRef } from "@/features/canvas-editing/utils/canvasObjectUtils";
import {
    COLOR_VERTEX_FILL,
    COLOR_EDGE_MIDPOINT_FILL,
    COLOR_EDGE_MIDPOINT_STROKE,
} from "@/config/canvas-editing/canvasConfig";
import { deriveActiveFill } from "@/utils/colorUtils";
import { usePolygonLayerStyle } from "@/features/canvas-editing/hooks/canvas-editor/usePolygonLayerStyle";
import { OBJECT_CATEGORY, type ObjectCategory } from "@/config/db-ops/enums";

interface CanvasVertexHandlesLayerProps {
    selectedObject: Object | null;
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
    const category = (selectedObject?.category ?? OBJECT_CATEGORY.ZONE) as ObjectCategory;
    const { stroke: accentColor, edgeWidth, showVertexIds } = usePolygonLayerStyle(category);
    const isLayerListening = activeTool === "select" && selectedObject !== null;
    const edgeMidpoints = selectedObject ? computeEdgeMidpoints(selectedObjectVertices) : [];
    if (!selectedObject) return <Layer />;
    const vertexRadius = Math.max(6, edgeWidth * 1.5) / scale;
    const vertexStrokeNormal = Math.max(2, edgeWidth * 0.4) / scale;
    const vertexStrokeActive = Math.max(3, edgeWidth * 0.6) / scale;
    const midpointRadius = Math.max(4, edgeWidth) / scale;
    const midpointStroke = Math.max(1.5, edgeWidth * 0.3) / scale;
    const activeFill = deriveActiveFill(COLOR_VERTEX_FILL);

    return (
        <Layer listening={isLayerListening}>
            {selectedObjectVertices.map((v, i) => {
                const ref: VertexRef = { objectId: selectedObject.id, index: i };
                const mid = edgeMidpoints[i];
                if (!mid) return null;

                const isActiveVertex =
                    selectedVertexRefs.some((sv) => sameVertexRef(sv, ref)) ||
                    (draggingVertexRef !== null && sameVertexRef(draggingVertexRef, ref));

                return [
                    <Circle
                        key={`vertex-handle-${i}`}
                        x={v.x}
                        y={v.y}
                        radius={vertexRadius}
                        fill={isActiveVertex ? activeFill : COLOR_VERTEX_FILL}
                        stroke={accentColor}
                        strokeWidth={isActiveVertex ? vertexStrokeActive : vertexStrokeNormal}
                        draggable
                        onClick={(e) => {
                            e.cancelBubble = true;
                            onVertexClick(ref, e.evt.ctrlKey || e.evt.metaKey);
                        }}
                        onDragStart={() => onVertexDragStart(ref)}
                        onDragMove={(e) => onVertexDragMove(ref, { x: e.target.x(), y: e.target.y() })}
                        onDragEnd={(e) => onVertexDragEnd(ref, { x: e.target.x(), y: e.target.y() })}
                        onMouseEnter={() => onHandleHoverChange(true)}
                        onMouseLeave={() => onHandleHoverChange(false)}
                    />,
                    showVertexIds && (
                        <CanvasVertexIdLabel
                            key={`vertex-id-label-${i}`}
                            index={i}
                            x={v.x}
                            y={v.y}
                            scale={scale}
                            edgeWidth={edgeWidth}
                            accentColor={accentColor}
                        />
                    ),
                    <Circle
                        key={`edge-midpoint-handle-${i}`}
                        x={mid.x}
                        y={mid.y}
                        radius={midpointRadius}
                        fill={COLOR_EDGE_MIDPOINT_FILL}
                        stroke={COLOR_EDGE_MIDPOINT_STROKE}
                        strokeWidth={midpointStroke}
                        onMouseDown={(e) => {
                            e.cancelBubble = true;
                            onEdgeMidpointMouseDown(selectedObject.id, i, mid);
                        }}
                        onMouseEnter={() => onHandleHoverChange(true)}
                        onMouseLeave={() => onHandleHoverChange(false)}
                    />,
                ];
            })}
        </Layer>
    );
}

export const CanvasVertexHandlesLayer = memo(CanvasVertexHandlesLayerInner);
