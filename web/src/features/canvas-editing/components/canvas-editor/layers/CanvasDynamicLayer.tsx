import { memo } from "react";
import type { LayerSettingView } from "@/data/local/layerTypes";
import type {
    ProviderLayerRecord,
    CanvasLineItem,
    CanvasPathItem,
    CanvasPointItem,
    CanvasPolygonItem,
    PointLabelColorEntry,
} from "@/data/local/serviceTypes";
import {
    resolveLineLayerStyle,
    resolvePointLayerStyle,
    resolvePolygonResultLayerStyle,
} from "@/features/canvas-editing/utils/resolveLayerStyle";
import { CanvasLineResultLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasLineResultLayer";
import { CanvasPathResultLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasPathResultLayer";
import { CanvasPointResultLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasPointResultLayer";
import { CanvasPolygonResultLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasPolygonResultLayer";

/**
 * Reads the JSON-encoded PointLabelColorEntry[] stored on the PointLabelEnum
 * settings row. This is the persisted source of truth — always available from
 * IndexedDB even after a page refresh without reconnecting to the provider.
 */
function extractLabelColorMapping(settings: LayerSettingView[]): PointLabelColorEntry[] {
    const row = settings.find((s) => s.styleType === "PointLabelEnum");
    if (!row?.value) return [];
    try {
        return JSON.parse(row.value) as PointLabelColorEntry[];
    } catch {
        return [];
    }
}

interface CanvasDynamicLayerProps {
    /** Provider layer metadata describing geometry type, computeLayer binding, and style defaults. */
    layerMeta: ProviderLayerRecord;
    /** Per-environment resolved settings for this layer, loaded from the layerSettings DB table. */
    settings: LayerSettingView[];
    /**
     * Raw data items extracted from the compute result for this layer's `computeLayer` key.
     * Typed as `unknown[]` — the terminal enforces the item contract (CanvasLineItem /
     * CanvasPointItem / CanvasPolygonItem) at the API boundary, not at runtime.
     */
    items: unknown[];
}

/**
 * Root parent component for all provider-defined algorithm output layers.
 *
 * This component is the single entry point from which all dynamic result layer
 * rendering is based. It is completely algorithm-agnostic: it resolves styles
 * from the settings array and dispatches to a type-specific Konva renderer
 * determined solely by `layerMeta.layerType`.
 *
 * All three style resolvers are always called (pure functions — no hooks).
 * Only the renderer matching `layerType` is mounted; others are discarded.
 */
function CanvasDynamicLayerInner({ layerMeta, settings, items }: CanvasDynamicLayerProps) {
    // Pure function calls — not React hooks. All three are always resolved;
    // only the one matching layerType is used by the mounted renderer.
    const lineStyle = resolveLineLayerStyle(settings);
    const pointStyle = resolvePointLayerStyle(settings);
    const polygonStyle = resolvePolygonResultLayerStyle(settings);

    switch (layerMeta.layerType) {
        case "Line": {
            if (!lineStyle.visible) return null;
            const first = (items as object[]).at(0);
            if (first && 'path' in first) {
                return (
                    <CanvasPathResultLayer
                        items={items as CanvasPathItem[]}
                        style={lineStyle}
                    />
                );
            }
            return (
                <CanvasLineResultLayer
                    items={items as CanvasLineItem[]}
                    style={lineStyle}
                />
            );
        }

        case "Point":
            if (!pointStyle.visible) return null;
            return (
                <CanvasPointResultLayer
                    items={items as CanvasPointItem[]}
                    style={pointStyle}
                    labelColorMapping={extractLabelColorMapping(settings)}
                />
            );

        case "Polygon":
            if (!polygonStyle.visible) return null;
            return (
                <CanvasPolygonResultLayer
                    items={items as CanvasPolygonItem[]}
                    style={polygonStyle}
                />
            );

        default:
            return null;
    }
}

export const CanvasDynamicLayer = memo(CanvasDynamicLayerInner);
