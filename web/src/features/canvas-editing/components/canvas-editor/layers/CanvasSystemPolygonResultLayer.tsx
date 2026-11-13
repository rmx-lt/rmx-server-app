import { memo } from "react";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { resolvePolygonResultLayerStyle } from "@/features/canvas-editing/utils/resolveLayerStyle";
import { CanvasPolygonResultLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasPolygonResultLayer";
import type { CanvasPolygonItem } from "@/data/local/serviceTypes";

interface CanvasSystemPolygonResultLayerProps {
    layerId: number;
    items: CanvasPolygonItem[];
}

function CanvasSystemPolygonResultLayerInner({ layerId, items }: CanvasSystemPolygonResultLayerProps) {
    const layers = useLayerSettingsStore((s) => s.layers);
    const layerSettings = layers.find(
        (l) => l.layer.id === layerId && l.layer.algorithmId === 0 && l.layer.providerId === 0,
    )?.settings ?? [];

    const style = resolvePolygonResultLayerStyle(layerSettings);
    if (!style.visible || items.length === 0) return null;

    return <CanvasPolygonResultLayer items={items} style={style} />;
}

export const CanvasSystemPolygonResultLayer = memo(CanvasSystemPolygonResultLayerInner);
