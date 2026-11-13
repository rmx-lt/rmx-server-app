import { useLayerSettingsStore, getLayerParam } from "@/model/layerSettingsStore";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";
import { OBJECT_CATEGORY, type ObjectCategory } from "@/config/db-ops/enums";

interface PolygonLayerStyle {
    /** Whether the layer is currently set to visible. */
    visible: boolean;
    /** Polygon edge / accent color. */
    stroke: string;
    /** Polygon fill color. */
    fill: string;
    /** Polygon edge width in world-space pixels. */
    edgeWidth: number;
    /** Whether vertex index labels should be shown. */
    showVertexIds: boolean;
}

const DEFAULTS = {
    zone: { stroke: "#22c55e", fill: "#22c55e2e" },
    obstacle: { stroke: "#ef4444", fill: "#ef44443b" },
} as const;

/**
 * Reads all style parameters for the given polygon category from layerSettingsStore.
 * Centralises the repeated getLayerParam calls that previously appeared in every
 * canvas layer component.
 */
export function usePolygonLayerStyle(category: ObjectCategory): PolygonLayerStyle {
    const layers = useLayerSettingsStore((s) => s.layers);
    const layerId = category === OBJECT_CATEGORY.ZONE ? LAYER_ID.ZONES : LAYER_ID.OBSTACLES;
    const def = DEFAULTS[category as keyof typeof DEFAULTS] ?? DEFAULTS.zone;
    return {
        visible: getLayerParam(layers, layerId, LAYER_PARAM_KEY.VISIBLE) !== "false",
        stroke: getLayerParam(layers, layerId, LAYER_PARAM_KEY.POLYGON_EDGE_COLOR) ?? def.stroke,
        fill: getLayerParam(layers, layerId, LAYER_PARAM_KEY.POLYGON_FILL_COLOR) ?? def.fill,
        edgeWidth: parseFloat(getLayerParam(layers, layerId, LAYER_PARAM_KEY.POLYGON_EDGE_WIDTH) ?? "1.5"),
        showVertexIds: getLayerParam(layers, layerId, LAYER_PARAM_KEY.SHOW_VERTEX_IDS) !== "false",
    };
}
