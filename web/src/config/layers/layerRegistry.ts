import type { LayerDefinition, LayerSettingsSetup } from "@/data/local/layerTypes";

export const LAYER_NAME = {
    GRID: "Grid",
    COVERAGE_GRID: "Coverage Grid",
    ZONES: "Zones",
    OBSTACLES: "Obstacles",
    SHRUNKEN_ZONES: "Shrunken Zones",
    EXPANDED_OBSTACLES: "Expanded Obstacles",
    ENV_POINTS: "Env Points",
    SATELLITE_MAP: "Satellite Map",
} as const;

export type LayerName = (typeof LAYER_NAME)[keyof typeof LAYER_NAME];

export const LAYER_ID = {
    GRID: 1,
    ZONES: 2,
    OBSTACLES: 3,
    ENV_POINTS: 4,
    COVERAGE_GRID: 5,
    SATELLITE_MAP: 6,
    SHRUNKEN_ZONES: 7,
    EXPANDED_OBSTACLES: 8,
} as const;

export const LAYER_REGISTRY: LayerDefinition[] = [
    { id: LAYER_ID.GRID, name: LAYER_NAME.GRID, type: "Grid" },
    { id: LAYER_ID.COVERAGE_GRID, name: LAYER_NAME.COVERAGE_GRID, type: "Grid" },
    { id: LAYER_ID.ZONES, name: LAYER_NAME.ZONES, type: "Polygon" },
    { id: LAYER_ID.SHRUNKEN_ZONES, name: LAYER_NAME.SHRUNKEN_ZONES, type: "Polygon" },
    { id: LAYER_ID.OBSTACLES, name: LAYER_NAME.OBSTACLES, type: "Polygon" },
    { id: LAYER_ID.EXPANDED_OBSTACLES, name: LAYER_NAME.EXPANDED_OBSTACLES, type: "Polygon" },
    { id: LAYER_ID.ENV_POINTS, name: LAYER_NAME.ENV_POINTS, type: "EnvPoints" },
    { id: LAYER_ID.SATELLITE_MAP, name: LAYER_NAME.SATELLITE_MAP, type: "Map" },
];

export const POLYGON_EDGE_STYLE = {
    SOLID: "Solid",
    DASHED: "Dashed",
    DOTTED: "Dotted",
} as const;
export type PolygonEdgeStyle = (typeof POLYGON_EDGE_STYLE)[keyof typeof POLYGON_EDGE_STYLE];

export const POLYGON_FILL_STYLE = {
    SOLID: "Solid",
    NONE: "None",
} as const;
export type PolygonFillStyle = (typeof POLYGON_FILL_STYLE)[keyof typeof POLYGON_FILL_STYLE];

/**
 * Human-readable keys for layer settings parameters.
 * Use these constants anywhere a layer param name is compared or looked up — never raw strings.
 */
export const LAYER_PARAM_KEY = {
    VISIBLE: "Visible",
    SHOW_VERTEX_IDS: "Show Vertex IDs",
    Z_INDEX: "Z-Index",
    GRID_LINE_COLOR: "Grid Line Color",
    COVERAGE_GRID_CELL_SIZE: "Coverage Grid Cell Size",
    COVERAGE_GRID_SHOW_GRID: "Coverage Grid Show Grid",
    COVERAGE_GRID_LINE_COLOR: "Coverage Grid Line Color",
    COVERAGE_GRID_LINE_WIDTH: "Coverage Grid Line Width",
    COVERAGE_GRID_FILL_OPACITY: "Coverage Grid Fill Opacity",
    POLYGON_EDGE_COLOR: "Polygon Edge Color",
    POLYGON_EDGE_WIDTH: "Polygon Edge Width",
    POLYGON_FILL_COLOR: "Polygon Fill Color",
    START_POINT_COLOR: "Start Point Color",
    START_POINT_RADIUS: "Start Point Radius",
    START_POINT_STROKE_COLOR: "Start Point Stroke Color",
    END_POINT_COLOR: "End Point Color",
    END_POINT_RADIUS: "End Point Radius",
    END_POINT_STROKE_COLOR: "End Point Stroke Color",
    START_END_POINT_COLOR: "Start & End Point Color",
    START_END_POINT_RADIUS: "Start & End Point Radius",
    START_END_POINT_STROKE_COLOR: "Start & End Point Stroke Color",
    MAP_OPACITY: "Map Opacity",
} as const;
export type LayerParamKey = (typeof LAYER_PARAM_KEY)[keyof typeof LAYER_PARAM_KEY];

// ─── Layer Settings Setup Defaults ───────────────────────────────────────────
//
// `id` matches the API attribute ID from the blade-provider Debug Layer Styles spec.
// Uniqueness is enforced by the compound PK [id+layerId] in the DB, so the same
// attribute ID can appear in multiple layers.
//
// Internal attributes (not part of the API spec, styleType: "Boolean"):
//   id 1  → "Visible"           (all layers)
//   id 2  → "Show Vertex IDs"   (Polygon layers)
//
// API attribute IDs in use (configurable):
//   id 5  → "Z-Index"            (all layers)       styleType: "Integer"
//   id 10 → "Grid Line Color"    (Grid layer)        styleType: "Color"
//   id 60 → "Polygon Edge Color" (Polygon layers)    styleType: "Color"
//   id 61 → "Polygon Edge Width" (Polygon layers)    styleType: "Pixels"
//   id 80 → "Polygon Fill Color" (Polygon layers)    styleType: "Color"
//
// API attribute IDs reserved (static, not seeded for system layers):
//   id 62 → "Polygon Edge Style"  (debug Polygon layers only; always Solid for system layers)
//   id 81 → "Polygon Fill Style"  (debug Polygon layers only; always Solid for system layers)
//
// Only non-null default values are seeded; attributes that default to null are
// absent from the DB until set by the user. Higher Z-Index renders above lower.

export const LAYER_SETTINGS_SETUP_DEFAULTS: LayerSettingsSetup[] = [
    // ── Grid (internal Grid type) ────────────────────────────────────────────
    { id: 1, layerId: LAYER_ID.GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.VISIBLE, styleType: "Boolean", styleGroup: "general", defaultValue: "true" },
    { id: 5, layerId: LAYER_ID.GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.Z_INDEX, styleType: "Integer", styleGroup: "general", defaultValue: "10" },
    { id: 10, layerId: LAYER_ID.GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.GRID_LINE_COLOR, styleType: "Color", styleGroup: "general", defaultValue: "#e2e8f0" },

    // ── Coverage Grid (internal Grid type) ──────────────────────────────────
    { id: 1, layerId: LAYER_ID.COVERAGE_GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.VISIBLE, styleType: "Boolean", styleGroup: "general", defaultValue: "false" },
    { id: 5, layerId: LAYER_ID.COVERAGE_GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.Z_INDEX, styleType: "Integer", styleGroup: "general", defaultValue: "15" },
    { id: 11, layerId: LAYER_ID.COVERAGE_GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.COVERAGE_GRID_CELL_SIZE, styleType: "Integer", styleGroup: "general", defaultValue: "50" },
    { id: 15, layerId: LAYER_ID.COVERAGE_GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.COVERAGE_GRID_SHOW_GRID, styleType: "Boolean", styleGroup: "general", defaultValue: "false" },
    { id: 12, layerId: LAYER_ID.COVERAGE_GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.COVERAGE_GRID_LINE_COLOR, styleType: "Color", styleGroup: "line", defaultValue: "#062e412d" },
    { id: 13, layerId: LAYER_ID.COVERAGE_GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.COVERAGE_GRID_LINE_WIDTH, styleType: "Pixels", styleGroup: "line", defaultValue: "1" },
    { id: 14, layerId: LAYER_ID.COVERAGE_GRID, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.COVERAGE_GRID_FILL_OPACITY, styleType: "Pixels", styleGroup: "line", defaultValue: "75" },

    // ── Zones (Polygon) ──────────────────────────────────────────────────────
    { id: 1, layerId: LAYER_ID.ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.VISIBLE, styleType: "Boolean", styleGroup: "general", defaultValue: "true" },
    { id: 2, layerId: LAYER_ID.ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.SHOW_VERTEX_IDS, styleType: "Boolean", defaultValue: "false" },
    { id: 5, layerId: LAYER_ID.ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.Z_INDEX, styleType: "Integer", styleGroup: "general", defaultValue: "20" },
    { id: 60, layerId: LAYER_ID.ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_EDGE_COLOR, styleType: "Color", styleGroup: "polygon", defaultValue: "#22c55e" },
    { id: 61, layerId: LAYER_ID.ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_EDGE_WIDTH, styleType: "Pixels", styleGroup: "polygon", defaultValue: "1.5" },
    // rgba(34,197,94,0.18) ≈ #22c55e2e
    { id: 80, layerId: LAYER_ID.ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_FILL_COLOR, styleType: "Color", styleGroup: "polygon", defaultValue: "#22c55e2e" },

    // ── Obstacles (Polygon) ──────────────────────────────────────────────────
    { id: 1, layerId: LAYER_ID.OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.VISIBLE, styleType: "Boolean", styleGroup: "general", defaultValue: "true" },
    { id: 2, layerId: LAYER_ID.OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.SHOW_VERTEX_IDS, styleType: "Boolean", defaultValue: "false" },
    { id: 5, layerId: LAYER_ID.OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.Z_INDEX, styleType: "Integer", styleGroup: "general", defaultValue: "30" },
    { id: 60, layerId: LAYER_ID.OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_EDGE_COLOR, styleType: "Color", styleGroup: "polygon", defaultValue: "#ef4444" },
    { id: 61, layerId: LAYER_ID.OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_EDGE_WIDTH, styleType: "Pixels", styleGroup: "polygon", defaultValue: "1.5" },
    // rgba(239,68,68,0.23) ≈ #ef44443b
    { id: 80, layerId: LAYER_ID.OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_FILL_COLOR, styleType: "Color", styleGroup: "polygon", defaultValue: "#ef44443b" },

    // ── Shrunken Zones (Polygon) ─────────────────────────────────────────────
    { id: 1, layerId: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.VISIBLE, styleType: "Boolean", styleGroup: "general", defaultValue: "false" },
    { id: 2, layerId: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.SHOW_VERTEX_IDS, styleType: "Boolean", defaultValue: "false" },
    { id: 5, layerId: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.Z_INDEX, styleType: "Integer", styleGroup: "general", defaultValue: "25" },
    { id: 60, layerId: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_EDGE_COLOR, styleType: "Color", styleGroup: "polygon", defaultValue: "#22c55e" },
    { id: 61, layerId: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_EDGE_WIDTH, styleType: "Pixels", styleGroup: "polygon", defaultValue: "2" },
    { id: 62, layerId: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0, key: "Polygon Edge Style", styleType: "StrokeStyleEnum", styleGroup: "polygon", defaultValue: "dotted" },
    { id: 80, layerId: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_FILL_COLOR, styleType: "Color", styleGroup: "polygon", defaultValue: "" },

    // ── Expanded Obstacles (Polygon) ─────────────────────────────────────────
    { id: 1, layerId: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.VISIBLE, styleType: "Boolean", styleGroup: "general", defaultValue: "false" },
    { id: 2, layerId: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.SHOW_VERTEX_IDS, styleType: "Boolean", defaultValue: "false" },
    { id: 5, layerId: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.Z_INDEX, styleType: "Integer", styleGroup: "general", defaultValue: "35" },
    { id: 60, layerId: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_EDGE_COLOR, styleType: "Color", styleGroup: "polygon", defaultValue: "#ef4444" },
    { id: 61, layerId: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_EDGE_WIDTH, styleType: "Pixels", styleGroup: "polygon", defaultValue: "2" },
    { id: 62, layerId: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0, key: "Polygon Edge Style", styleType: "StrokeStyleEnum", styleGroup: "polygon", defaultValue: "dotted" },
    { id: 80, layerId: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.POLYGON_FILL_COLOR, styleType: "Color", styleGroup: "polygon", defaultValue: "" },

    // ── Env Points ───────────────────────────────────────────────────────────
    { id: 1, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.VISIBLE, styleType: "Boolean", styleGroup: "general", defaultValue: "true" },
    { id: 5, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.Z_INDEX, styleType: "Integer", styleGroup: "general", defaultValue: "40" },
    { id: 20, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.START_POINT_COLOR, styleType: "Color", styleGroup: "startPoint", defaultValue: "#22c55e" },
    { id: 21, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.START_POINT_RADIUS, styleType: "Pixels", styleGroup: "startPoint", defaultValue: "3" },
    { id: 22, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.START_POINT_STROKE_COLOR, styleType: "Color", styleGroup: "startPoint", defaultValue: "#166534" },
    { id: 23, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.END_POINT_COLOR, styleType: "Color", styleGroup: "endPoint", defaultValue: "#ef4444" },
    { id: 24, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.END_POINT_RADIUS, styleType: "Pixels", styleGroup: "endPoint", defaultValue: "3" },
    { id: 25, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.END_POINT_STROKE_COLOR, styleType: "Color", styleGroup: "endPoint", defaultValue: "#991b1b" },
    { id: 26, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.START_END_POINT_COLOR, styleType: "Color", styleGroup: "startEndPoint", defaultValue: "#a855f7" },
    { id: 27, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.START_END_POINT_RADIUS, styleType: "Pixels", styleGroup: "startEndPoint", defaultValue: "3" },
    { id: 28, layerId: LAYER_ID.ENV_POINTS, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.START_END_POINT_STROKE_COLOR, styleType: "Color", styleGroup: "startEndPoint", defaultValue: "#6b21a8" },

    // ── Satellite Map ────────────────────────────────────────────────────────
    { id: 1, layerId: LAYER_ID.SATELLITE_MAP, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.VISIBLE, styleType: "Boolean", styleGroup: "general", defaultValue: "false" },
    { id: 5, layerId: LAYER_ID.SATELLITE_MAP, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.Z_INDEX, styleType: "Integer", styleGroup: "general", defaultValue: "1" },
    { id: 90, layerId: LAYER_ID.SATELLITE_MAP, algorithmId: 0, providerId: 0, key: LAYER_PARAM_KEY.MAP_OPACITY, styleType: "Pixels", styleGroup: "general", defaultValue: "100" },
];

