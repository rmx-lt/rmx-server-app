import { memo } from "react";
import { Layer, Line, Group, Text } from "react-konva";
import { MarkerShape } from "@/features/canvas-editing/utils/markerShape";
import { textPlacementCenter, TEXT_W, TEXT_OX } from "@/features/canvas-editing/utils/textPlacement";
import type { ResolvedPolygonResultLayerStyle } from "@/features/canvas-editing/types/layerStyles";
import type { CanvasPolygonItem } from "@/data/local/serviceTypes";

interface CanvasPolygonResultLayerProps {
    items: CanvasPolygonItem[];
    style: ResolvedPolygonResultLayerStyle;
}

/** Renders the ID badge background shape at the anchor point. */
function IdBadgeShape({
    x,
    y,
    style,
}: {
    x: number;
    y: number;
    style: ResolvedPolygonResultLayerStyle;
}) {
    if (!style.idShape) return null;
    return (
        <Group x={x} y={y}>
            <MarkerShape
                shape={style.idShape}
                radius={style.idRadius}
                fill={style.idFillColor}
                stroke={style.idBorderColor}
                strokeWidth={style.idBorderWidth}
                dash={style.idBorderDash}
                listening={false}
                perfectDrawEnabled={false}
            />
        </Group>
    );
}

/** Renders the ID badge text at the anchor point. */
function IdBadgeText({
    x,
    y,
    id,
    style,
}: {
    x: number;
    y: number;
    id: number;
    style: ResolvedPolygonResultLayerStyle;
}) {
    return (
        <Group x={x} y={y}>
            <Text
                text={String(id)}
                fill={style.idColor}
                fontSize={style.idFontSize}
                fontStyle={style.idFontWeight}
                width={TEXT_W}
                height={style.idFontSize * 1.5}
                offsetX={TEXT_OX}
                offsetY={style.idFontSize * 0.75}
                align="center"
                verticalAlign="middle"
                listening={false}
                perfectDrawEnabled={false}
            />
        </Group>
    );
}

/** Renders the shape (circle or square) of a single corner-vertex marker. */
function VertexMarkerShape({
    x,
    y,
    style,
}: {
    x: number;
    y: number;
    style: ResolvedPolygonResultLayerStyle;
}) {
    return (
        <Group x={x} y={y}>
            <MarkerShape
                shape={style.vertexShape}
                radius={style.vertexRadius}
                fill={style.vertexFillColor}
                stroke={style.vertexBorderColor}
                strokeWidth={style.vertexBorderWidth}
                dash={style.vertexBorderDash}
                listening={false}
                perfectDrawEnabled={false}
            />
        </Group>
    );
}

/** Renders the ID label text for a single corner-vertex marker. */
function VertexMarkerLabel({
    x,
    y,
    index,
    style,
}: {
    x: number;
    y: number;
    index: number;
    style: ResolvedPolygonResultLayerStyle;
}) {
    const { dx: off_dx, dy: off_dy, align: off_align, offsetX: off_ox } = textPlacementCenter(style.vertexIdPlacement, style.vertexIdOffset);
    return (
        <Group x={x} y={y}>
            <Text
                x={off_dx}
                y={off_dy}
                text={String(index)}
                fill={style.vertexIdColor}
                fontSize={style.vertexIdFontSize}
                fontStyle={style.vertexIdFontWeight}
                width={TEXT_W}
                height={style.vertexIdFontSize * 1.5}
                offsetX={off_ox}
                offsetY={style.vertexIdFontSize * 0.75}
                align={off_align}
                verticalAlign="middle"
                listening={false}
                perfectDrawEnabled={false}
            />
        </Group>
    );
}

function CanvasPolygonResultLayerInner({ items, style }: CanvasPolygonResultLayerProps) {
    const showId = style.idPlacement !== "";
    const showVertices = style.vertexShape !== "";
    const showVertexLabels = style.vertexIdPlacement !== "";
    // fillStyle "hatched" renders diagonal stripes using two overlapping fills
    const isHatched = style.fillStyle === "hatched";

    return (
        <Layer>
            {/* ── Shape pass: polygon edges, fills, vertex markers, badge backgrounds ── */}
            {items.map((item) => {
                if (!item.vertices) return null;
                const points = item.vertices.flatMap((v) => [v.x, v.y]);
                const anchor = item.centroidPoint ?? item.vertices[0];
                return (
                    <Group key={`s-${item.id}`}>
                        {/* Base polygon fill */}
                        <Line
                            points={points}
                            closed
                            fill={style.fill}
                            stroke={style.stroke}
                            strokeWidth={style.strokeWidth}
                            dash={style.dash}
                            lineCap="round"
                            lineJoin="round"
                            listening={false}
                            perfectDrawEnabled={false}
                        />
                        {/* Hatched overlay */}
                        {isHatched && (
                            <Line
                                points={points}
                                closed
                                fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                                fillLinearGradientEndPoint={{ x: 8, y: 8 }}
                                fillLinearGradientColorStops={[
                                    0, style.fill,
                                    0.4999, style.fill,
                                    0.5, "transparent",
                                    1, "transparent",
                                ]}
                                stroke=""
                                strokeWidth={0}
                                listening={false}
                                perfectDrawEnabled={false}
                            />
                        )}
                        {/* Corner vertex marker shapes */}
                        {showVertices && item.vertices.map((v, vi) => (
                            <VertexMarkerShape key={vi} x={v.x} y={v.y} style={style} />
                        ))}
                        {/* Polygon ID badge background */}
                        {showId && anchor !== undefined && (
                            <IdBadgeShape
                                x={anchor.x + style.idOffset}
                                y={anchor.y + style.idOffset}
                                style={style}
                            />
                        )}
                    </Group>
                );
            })}
            {/* ── Text pass: vertex labels and polygon ID texts rendered above all shapes ── */}
            {items.map((item) => {
                if (!item.vertices) return null;
                const anchor = item.centroidPoint ?? item.vertices[0];
                return (
                    <Group key={`t-${item.id}`}>
                        {showVertexLabels && item.vertices.map((v, vi) => (
                            <VertexMarkerLabel key={vi} x={v.x} y={v.y} index={vi} style={style} />
                        ))}
                        {showId && anchor !== undefined && (
                            <IdBadgeText
                                x={anchor.x + style.idOffset}
                                y={anchor.y + style.idOffset}
                                id={item.id}
                                style={style}
                            />
                        )}
                    </Group>
                );
            })}
        </Layer>
    );
}

export const CanvasPolygonResultLayer = memo(CanvasPolygonResultLayerInner);
