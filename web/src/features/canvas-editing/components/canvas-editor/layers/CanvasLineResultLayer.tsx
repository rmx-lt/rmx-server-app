import { memo } from "react";
import { Layer, Line, Group, Text } from "react-konva";
import { MarkerShape } from "@/features/canvas-editing/utils/markerShape";
import { textPlacementCenter, TEXT_W } from "@/features/canvas-editing/utils/textPlacement";
import type { ResolvedLineLayerStyle } from "@/features/canvas-editing/types/layerStyles";
import type { CanvasLineItem } from "@/data/local/serviceTypes";
import {
    arrowHeadPoints,
    interpolatePolyline,
    isNotchArrow,
    isStartArrow,
    midArrowPositions,
    polylineLength,
} from "@/features/canvas-editing/utils/arrowUtils";

interface CanvasLineResultLayerProps {
    items: CanvasLineItem[];
    style: ResolvedLineLayerStyle;
}

/**
 * When multiple items share the same canvas position, spreads them in a grid
 * so they don't overlap. Returns per-item {dx, dy} offsets.
 */
function computeOverlapOffsets(
    items: CanvasLineItem[],
    spacing: number,
    layout: string,
): Map<number, { dx: number; dy: number }> {
    const offsets = new Map<number, { dx: number; dy: number }>();
    if (!spacing || layout !== "grid") {
        items.forEach((item) => offsets.set(item.id, { dx: 0, dy: 0 }));
        return offsets;
    }
    const groups = new Map<string, CanvasLineItem[]>();
    for (const item of items) {
        const key = `${item.point.x},${item.point.y}`;
        const group = groups.get(key);
        if (group) group.push(item);
        else groups.set(key, [item]);
    }
    for (const group of groups.values()) {
        const n = group.length;
        const cols = Math.ceil(Math.sqrt(n));
        group.forEach((item, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const totalCols = Math.min(cols, n - row * cols);
            const dx = (col - (totalCols - 1) / 2) * spacing;
            const dy = (row - (Math.ceil(n / cols) - 1) / 2) * spacing;
            offsets.set(item.id, { dx, dy });
        });
    }
    return offsets;
}

function CanvasLineResultLayerInner({ items, style }: CanvasLineResultLayerProps) {
    const overlapOffsets = computeOverlapOffsets(
        items,
        style.pointOverlapSpacing,
        style.pointOverlapLayout,
    );

    // Apply overlap offsets to each item's point position
    const resolvedPoints = items.map((item) => {
        const off = overlapOffsets.get(item.id) ?? { dx: 0, dy: 0 };
        return { ...item, point: { x: item.point.x + off.dx, y: item.point.y + off.dy } };
    });

    const flatPoints = resolvedPoints.flatMap((item) => [item.point.x, item.point.y]);
    const showMarkers = style.pointShape !== "";

    // Arrow rendering helpers
    const totalLen = polylineLength(flatPoints);
    const arrowSize = style.arrowSize;

    const startArrowPoints =
        style.arrowStart && flatPoints.length >= 4
            ? (() => {
                const { point, angle } = interpolatePolyline(flatPoints, 0);
                const dir = isStartArrow(style.arrowStart) ? angle + Math.PI : angle;
                return arrowHeadPoints(point.x, point.y, dir, arrowSize, isNotchArrow(style.arrowStart));
            })()
            : null;

    const endArrowPoints =
        style.arrowEnd && flatPoints.length >= 4
            ? (() => {
                const { point, angle } = interpolatePolyline(flatPoints, 1);
                const dir = isStartArrow(style.arrowEnd) ? angle + Math.PI : angle;
                return arrowHeadPoints(point.x, point.y, dir, arrowSize, isNotchArrow(style.arrowEnd));
            })()
            : null;

    const midArrows =
        style.arrowMid && style.arrowMidSpacing > 0 && flatPoints.length >= 4
            ? midArrowPositions(totalLen, style.arrowMidSpacing).map((t) => {
                const { point, angle } = interpolatePolyline(flatPoints, t);
                const dir = isStartArrow(style.arrowMid) ? angle + Math.PI : angle;
                return arrowHeadPoints(point.x, point.y, dir, arrowSize, isNotchArrow(style.arrowMid));
            })
            : [];

    const arrowStrokeProps = {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        lineCap: "round" as const,
        lineJoin: "round" as const,
        listening: false as const,
        perfectDrawEnabled: false as const,
    };

    return (
        <Layer>
            {/* Main polyline */}
            <Line
                points={flatPoints}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                dash={style.dash}
                lineCap="round"
                lineJoin="round"
                listening={false}
                perfectDrawEnabled={false}
            />
            {/* Start arrow */}
            {startArrowPoints && (
                <Line points={startArrowPoints} closed={!isNotchArrow(style.arrowStart)} fill={style.stroke} {...arrowStrokeProps} />
            )}
            {/* End arrow */}
            {endArrowPoints && (
                <Line points={endArrowPoints} closed={!isNotchArrow(style.arrowEnd)} fill={style.stroke} {...arrowStrokeProps} />
            )}
            {/* Mid arrows */}
            {midArrows.map((pts, i) => (
                <Line key={i} points={pts} closed={!isNotchArrow(style.arrowMid)} fill={style.stroke} {...arrowStrokeProps} />
            ))}
            {/* ── Shape pass: point markers ── */}
            {showMarkers && resolvedPoints.map((item) => (
                <Group key={`s-${item.id}`} x={item.point.x} y={item.point.y} listening={false}>
                    <MarkerShape
                        shape={style.pointShape}
                        radius={style.pointRadius}
                        fill={style.pointFillColor}
                        stroke={style.pointBorderColor || undefined}
                        strokeWidth={style.pointBorderWidth}
                        dash={style.pointBorderDash}
                        listening={false}
                        perfectDrawEnabled={false}
                    />
                </Group>
            ))}
            {/* ── Text pass: point ID and label texts rendered above all markers ── */}
            {showMarkers && resolvedPoints.map((item) => (
                <Group key={`t-${item.id}`} x={item.point.x} y={item.point.y} listening={false}>
                    {style.pointIdPlacement !== "" && (() => {
                        const { dx, dy, align, offsetX } = textPlacementCenter(style.pointIdPlacement, style.pointIdOffset);
                        return (
                            <Text
                                x={dx}
                                y={dy}
                                text={String(item.id)}
                                fill={style.pointIdColor}
                                fontSize={style.pointIdFontSize}
                                fontStyle={style.pointIdFontWeight}
                                width={TEXT_W}
                                height={style.pointIdFontSize * 1.5}
                                offsetX={offsetX}
                                offsetY={style.pointIdFontSize * 0.75}
                                align={align}
                                verticalAlign="middle"
                                listening={false}
                            />
                        );
                    })()}
                    {style.pointLabelPlacement !== "" && item.pointLabel !== undefined && (() => {
                        const { dx, dy, align, offsetX } = textPlacementCenter(style.pointLabelPlacement, style.pointLabelOffset);
                        return (
                            <Text
                                x={dx}
                                y={dy}
                                text={String(item.pointLabel)}
                                fill={style.pointLabelColor}
                                fontSize={style.pointLabelFontSize}
                                fontStyle={style.pointLabelFontWeight}
                                width={TEXT_W}
                                height={style.pointLabelFontSize * 1.5}
                                offsetX={offsetX}
                                offsetY={style.pointLabelFontSize * 0.75}
                                align={align}
                                verticalAlign="middle"
                                listening={false}
                            />
                        );
                    })()}
                </Group>
            ))}
        </Layer>
    );
}

export const CanvasLineResultLayer = memo(CanvasLineResultLayerInner);
