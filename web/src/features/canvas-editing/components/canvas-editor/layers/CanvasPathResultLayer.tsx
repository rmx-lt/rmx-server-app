import { memo, Fragment } from "react";
import { Layer, Line, Group, Text } from "react-konva";
import { MarkerShape } from "@/features/canvas-editing/utils/markerShape";
import { textPlacementCenter, TEXT_W } from "@/features/canvas-editing/utils/textPlacement";
import type { ResolvedLineLayerStyle } from "@/features/canvas-editing/types/layerStyles";
import type { CanvasPathItem } from "@/data/local/serviceTypes";
import {
    arrowHeadPoints,
    interpolatePolyline,
    isNotchArrow,
    isStartArrow,
    midArrowPositions,
    polylineLength,
} from "@/features/canvas-editing/utils/arrowUtils";

interface CanvasPathResultLayerProps {
    items: CanvasPathItem[];
    style: ResolvedLineLayerStyle;
}

function CanvasPathResultLayerInner({ items, style }: CanvasPathResultLayerProps) {
    const arrowSize = style.arrowSize;
    const showMarkers = style.pointShape !== "";
    const showId = style.pointIdPlacement !== "";

    return (
        <Layer>
            {/* ── Shape pass: polylines, arrows, and waypoint markers ── */}
            {items.map((item) => {
                const flatPoints = item.path.flatMap((p) => [p.point.x, p.point.y]);
                const dash = style.dash;
                const hasArrows = flatPoints.length >= 4 && arrowSize > 0;
                const totalLen = hasArrows ? polylineLength(flatPoints) : 0;

                const startArrowPts =
                    hasArrows && style.arrowStart
                        ? (() => {
                            const { point, angle } = interpolatePolyline(flatPoints, 0);
                            const dir = isStartArrow(style.arrowStart) ? angle + Math.PI : angle;
                            return arrowHeadPoints(point.x, point.y, dir, arrowSize, isNotchArrow(style.arrowStart));
                        })()
                        : null;

                const endArrowPts =
                    hasArrows && style.arrowEnd
                        ? (() => {
                            const { point, angle } = interpolatePolyline(flatPoints, 1);
                            const dir = isStartArrow(style.arrowEnd) ? angle + Math.PI : angle;
                            return arrowHeadPoints(point.x, point.y, dir, arrowSize, isNotchArrow(style.arrowEnd));
                        })()
                        : null;

                const midArrows =
                    hasArrows && style.arrowMid && style.arrowMidSpacing > 0
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
                    <Fragment key={`s-${item.id}`}>
                        <Line
                            points={flatPoints}
                            stroke={style.stroke}
                            strokeWidth={style.strokeWidth}
                            dash={dash}
                            lineCap="round"
                            lineJoin="round"
                            listening={false}
                            perfectDrawEnabled={false}
                        />
                        {startArrowPts && (
                            <Line points={startArrowPts} closed={!isNotchArrow(style.arrowStart)} fill={style.stroke} {...arrowStrokeProps} />
                        )}
                        {endArrowPts && (
                            <Line points={endArrowPts} closed={!isNotchArrow(style.arrowEnd)} fill={style.stroke} {...arrowStrokeProps} />
                        )}
                        {midArrows.map((pts, mi) => (
                            <Line key={mi} points={pts} closed={!isNotchArrow(style.arrowMid)} fill={style.stroke} {...arrowStrokeProps} />
                        ))}
                        {showMarkers && item.path.map((wp) => (
                            <Group key={`${item.id}-wp-${wp.id}`} x={wp.point.x} y={wp.point.y} listening={false}>
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
                    </Fragment>
                );
            })}
            {/* ── Text pass: waypoint ID texts rendered above all markers ── */}
            {showMarkers && showId && items.map((item) => (
                <Fragment key={`t-${item.id}`}>
                    {item.path.map((wp) => {
                        const { dx, dy, align, offsetX } = textPlacementCenter(style.pointIdPlacement, style.pointIdOffset);
                        return (
                            <Group key={`${item.id}-wpt-${wp.id}`} x={wp.point.x} y={wp.point.y} listening={false}>
                                <Text
                                    x={dx}
                                    y={dy}
                                    text={String(wp.id)}
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
                            </Group>
                        );
                    })}
                </Fragment>
            ))}
        </Layer>
    );
}

export const CanvasPathResultLayer = memo(CanvasPathResultLayerInner);
