import { memo, useRef } from "react";
import { Layer, Line } from "react-konva";
import type { ActiveTool } from "@/features/canvas-editing/types/canvas";
import type React from "react";
import type { Area } from "@/data/planning/schemaTypes";
import { sameObject } from "@/features/canvas-editing/utils/canvasObjectUtils";
import type { AreaCategory } from "@/config/db-ops/enums";
import { LAYER_STYLE } from "@/config/canvas-editing/canvasConfig";
import { useCanvasColors } from "@/hooks/useTheme";

interface CanvasPolygonObjectsLayerProps {
    category: AreaCategory;
    objects: Area[];
    selectedObject: Area | null;
    movingObject: Area | null;
    activeTool: ActiveTool | null;
    scale: number;
    onSelectObject: (obj: Area) => void;
    onDeleteObject: (obj: Area) => void;
    onObjectHoverChange: (obj: Area | null) => void;
    onObjectDragStart: (obj: Area) => void;
    onObjectDragEnd: (obj: Area, dx: number, dy: number) => void;
    isPanningRef: React.RefObject<boolean>;
}

export function CanvasPolygonObjectsLayerInner({
    category,
    objects,
    selectedObject,
    movingObject,
    activeTool,
    scale,
    onSelectObject,
    onDeleteObject,
    onObjectHoverChange,
    onObjectDragStart,
    onObjectDragEnd,
    isPanningRef,
}: CanvasPolygonObjectsLayerProps) {
    const canInteract = activeTool === "select" || activeTool === "delete";
    const canDrag = activeTool === "select";

    // Coordinates onDragStart/onDragEnd: only true when a left-button drag is active.
    const primaryDragRef = useRef(false);

    const { stroke, fill } = useCanvasColors()[category];
    const { edgeWidth } = LAYER_STYLE[category];
    const layerObjects = objects.filter((obj) => obj.category === category);

    return (
        <Layer>
            {layerObjects.map((obj) => {
                const isSelected = selectedObject !== null && sameObject(obj, selectedObject) && activeTool === "select";
                const isMoving = movingObject !== null && sameObject(obj, movingObject);

                return (
                    <Line
                        key={obj.id}
                        points={obj.vertices.flatMap((v) => [v.x, v.y])}
                        closed
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={(isSelected || isMoving ? edgeWidth * 1.5 : edgeWidth) / scale}
                        opacity={isMoving ? 0.55 : 1}
                        dash={isMoving ? [8 / scale, 4 / scale] : undefined}
                        listening={canInteract}
                        hitStrokeWidth={8 / scale}
                        draggable={canDrag}
                        dragDistance={4}
                        onClick={(e) => {
                            e.cancelBubble = true;
                            if (activeTool === "delete") {
                                onDeleteObject(obj);
                            } else if (activeTool === "select") {
                                onSelectObject(obj);
                            }
                        }}
                        onDragStart={(e) => {
                            if (isPanningRef.current) {
                                return;
                            }
                            primaryDragRef.current = true;
                            e.cancelBubble = true;
                            onObjectDragStart(obj);
                        }}
                        onDragMove={(e) => {
                            if (isPanningRef.current) {
                                e.target.x(0);
                                e.target.y(0);
                            }
                        }}
                        onDragEnd={(e) => {
                            if (!primaryDragRef.current) return;
                            primaryDragRef.current = false;
                            e.cancelBubble = true;
                            const node = e.target;
                            const dx = node.x();
                            const dy = node.y();
                            node.x(0);
                            node.y(0);
                            onObjectDragEnd(obj, dx, dy);
                        }}
                        onMouseEnter={() => canInteract && onObjectHoverChange(obj)}
                        onMouseLeave={() => onObjectHoverChange(null)}
                    />
                );
            })}
        </Layer>
    );
}

export const CanvasPolygonObjectsLayer = memo(CanvasPolygonObjectsLayerInner);
