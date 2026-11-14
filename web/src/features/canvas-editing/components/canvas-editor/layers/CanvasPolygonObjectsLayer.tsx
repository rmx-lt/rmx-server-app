import { memo, useMemo, useRef } from "react";
import { Layer, Line } from "react-konva";
import type { ActiveTool } from "@/features/canvas-editing/types/canvas";
import type React from "react";
import type { Object } from "@/data/local/schemaTypes";
import { sameObject } from "@/features/canvas-editing/utils/canvasObjectUtils";
import { OBJECT_TYPE, type ObjectCategory } from "@/config/db-ops/enums";
import { usePolygonLayerStyle } from "@/features/canvas-editing/hooks/canvas-editor/usePolygonLayerStyle";

function createStripePatternCanvas(bgColor: string, stripeColor: string): HTMLCanvasElement {
    const stripeH = 16;
    const gap = 16;
    const tileSize = stripeH + gap;
    const canvas = document.createElement("canvas");
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, tileSize, tileSize);
    ctx.fillStyle = stripeColor;
    ctx.fillRect(0, 0, tileSize, stripeH);
    return canvas;
}

interface CanvasPolygonObjectsLayerProps {
    category: ObjectCategory;
    objects: Object[];
    selectedObject: Object | null;
    movingObject: Object | null;
    activeTool: ActiveTool | null;
    scale: number;
    onSelectObject: (obj: Object) => void;
    onDeleteObject: (obj: Object) => void;
    onObjectHoverChange: (obj: Object | null) => void;
    onObjectDragStart: (obj: Object) => void;
    onObjectDragEnd: (obj: Object, dx: number, dy: number) => void;
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

    const { visible, stroke, fill, edgeWidth } = usePolygonLayerStyle(category);

    const onlinePattern = useMemo(
        () => createStripePatternCanvas(fill, fill),
        [fill],
    );

    const visibleObjects = visible
        ? objects.filter((obj) => obj.category === category)
        : [];

    return (
        <Layer>
            {visibleObjects.map((obj) => {
                const isOnline = obj.type === OBJECT_TYPE.ONLINE;
                const isSelected = selectedObject !== null && sameObject(obj, selectedObject) && activeTool === "select";
                const isMoving = movingObject !== null && sameObject(obj, movingObject);
                const fillPattern = isOnline ? onlinePattern : undefined;

                return (
                    <Line
                        key={obj.id}
                        points={obj.vertices.flatMap((v) => [v.x, v.y])}
                        closed
                        fill={fillPattern ? undefined : fill}
                        fillPatternImage={fillPattern as unknown as HTMLImageElement}
                        fillPatternRotation={fillPattern ? 45 : undefined}
                        stroke={stroke}
                        strokeWidth={(isSelected || isMoving ? edgeWidth * 1.5 : edgeWidth) / scale}
                        opacity={isMoving ? 0.55 : 1}
                        dash={isMoving ? [8 / scale, 4 / scale] : isOnline ? [16 / scale, 4 / scale] : undefined}
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
