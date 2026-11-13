import { memo } from "react";
import { Layer, Group, Text } from "react-konva";
import { MarkerShape } from "@/features/canvas-editing/utils/markerShape";
import { textPlacementCenter, TEXT_W } from "@/features/canvas-editing/utils/textPlacement";
import type { ResolvedPointLayerStyle } from "@/features/canvas-editing/types/layerStyles";
import type { CanvasPointItem, PointLabelColorEntry } from "@/data/local/serviceTypes";

interface CanvasPointResultLayerProps {
    items: CanvasPointItem[];
    style: ResolvedPointLayerStyle;
    /** Per-label color overrides from layer metadata. Replaces fillColor for matching pointLabel values. */
    labelColorMapping: PointLabelColorEntry[];
}

function resolveFillColor(
    pointLabel: string | undefined,
    mapping: PointLabelColorEntry[],
    fallback: string,
): string {
    if (!pointLabel) return fallback;
    return mapping.find((e) => e.value === pointLabel)?.color ?? fallback;
}

/**
 * When multiple items share the same point (same pointLabel / centroid),
 * spreads them in a grid pattern so they don't overlap.
 * Returns per-item {dx, dy} offsets relative to the shared point.
 */
function computeOverlapOffsets(
    items: CanvasPointItem[],
    spacing: number,
    layout: string,
): Map<number, { dx: number; dy: number }> {
    const offsets = new Map<number, { dx: number; dy: number }>();
    if (!spacing || layout !== "grid") {
        items.forEach((item) => offsets.set(item.id, { dx: 0, dy: 0 }));
        return offsets;
    }

    // Group items by position key
    const groups = new Map<string, CanvasPointItem[]>();
    for (const item of items) {
        if (!item.point) continue;
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

function CanvasPointResultLayerInner({ items, style, labelColorMapping }: CanvasPointResultLayerProps) {
    const overlapOffsets = computeOverlapOffsets(items, style.overlapSpacing, style.overlapLayout);
    const showId = style.idPlacement !== "";
    const showLabel = style.labelPlacement !== "";

    return (
        <Layer>
            {/* ── Shape pass: all markers rendered before any text ── */}
            {items.map((item) => {
                if (!item.point) return null;
                const { dx: odx, dy: ody } = overlapOffsets.get(item.id) ?? { dx: 0, dy: 0 };
                const fill = resolveFillColor(item.pointLabel, labelColorMapping, style.fillColor);
                const border = resolveFillColor(item.pointLabel, labelColorMapping, style.borderColor);
                return (
                    <Group key={`s-${item.id}`} x={item.point.x + odx} y={item.point.y + ody}>
                        <MarkerShape
                            shape={style.shape}
                            radius={style.radius}
                            fill={fill}
                            stroke={border}
                            strokeWidth={style.borderWidth}
                            dash={style.borderDash}
                            listening={false}
                            perfectDrawEnabled={false}
                        />
                    </Group>
                );
            })}
            {/* ── Text pass: all ID and label text rendered above all markers ── */}
            {(showId || showLabel) && items.map((item) => {
                if (!item.point) return null;
                const { dx: odx, dy: ody } = overlapOffsets.get(item.id) ?? { dx: 0, dy: 0 };
                const idOff = showId ? textPlacementCenter(style.idPlacement, style.idOffset) : null;
                const labelPos = textPlacementCenter(style.labelPlacement, style.labelOffset);
                return (
                    <Group key={`t-${item.id}`} x={item.point.x + odx} y={item.point.y + ody}>
                        {showId && idOff !== null && (
                            <Text
                                x={idOff.dx}
                                y={idOff.dy}
                                text={String(item.id)}
                                fill={style.idColor}
                                fontSize={style.idFontSize}
                                fontStyle={style.idFontWeight}
                                width={TEXT_W}
                                height={style.idFontSize * 1.5}
                                offsetX={idOff.offsetX}
                                offsetY={style.idFontSize * 0.75}
                                align={idOff.align}
                                verticalAlign="middle"
                                listening={false}
                                perfectDrawEnabled={false}
                            />
                        )}
                        {showLabel && item.pointLabel !== undefined && (
                            <Text
                                x={labelPos.dx}
                                y={labelPos.dy}
                                text={String(item.pointLabel)}
                                fill={resolveFillColor(item.pointLabel, labelColorMapping, style.labelColor)}
                                fontSize={style.labelFontSize}
                                fontStyle={style.labelFontWeight}
                                width={TEXT_W}
                                height={style.labelFontSize * 1.5}
                                offsetX={labelPos.offsetX}
                                offsetY={style.labelFontSize * 0.75}
                                align={labelPos.align}
                                verticalAlign="middle"
                                listening={false}
                                perfectDrawEnabled={false}
                            />
                        )}
                    </Group>
                );
            })}
        </Layer>
    );
}

export const CanvasPointResultLayer = memo(CanvasPointResultLayerInner);
