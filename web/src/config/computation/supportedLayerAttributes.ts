import type { MetadataLayerType, StyleAttributeKey, StyleType } from "@/data/local/serviceTypes";

export const SUPPORTED_LAYER_TYPES = new Set<MetadataLayerType>(["Point", "Line", "Polygon"]);

export function isSupportedLayerType(value: string): value is MetadataLayerType {
    return SUPPORTED_LAYER_TYPES.has(value as MetadataLayerType);
}

const STYLE_ATTRIBUTE_KEY_LIST: StyleAttributeKey[] = [
    "Visible",
    "Z-Index",
    // Point — Marker Shape
    "Point Shape",
    "Point Radius",
    // Point — Overlap
    "Point Overlap Spacing",
    "Point Overlap Layout",
    // Point — Border
    "Point Border Color",
    "Point Border Width",
    "Point Border Style",
    // Point — Fill
    "Point Fill Color",
    // Point — Id Label
    "Point ID Color",
    "Point ID Font Size",
    "Point ID Font Weight",
    "Point ID Placement",
    "Point ID Offset",
    // Point — Text Label
    "Point Label Color",
    "Point Label Font Size",
    "Point Label Font Weight",
    "Point Label Placement",
    "Point Label Offset",
    // Line — Edge
    "Line Edge Color",
    "Line Edge Width",
    "Line Edge Style",
    // Line — Arrow
    "Line Arrow Start",
    "Line Arrow End",
    "Line Arrow Mid",
    "Line Arrow Mid Spacing",
    "Line Arrow Size",
    // Polygon — Edge
    "Polygon Edge Color",
    "Polygon Edge Width",
    "Polygon Edge Style",
    // Polygon — Fill
    "Polygon Fill Color",
    "Polygon Fill Style",
    // Polygon — ID
    "Polygon ID Color",
    "Polygon ID Font Size",
    "Polygon ID Font Weight",
    "Polygon ID Shape",
    "Polygon ID Radius",
    "Polygon ID Border Color",
    "Polygon ID Border Width",
    "Polygon ID Border Style",
    "Polygon ID Fill Color",
    "Polygon ID Placement",
    "Polygon ID Offset",
];

export const SUPPORTED_STYLE_ATTRIBUTE_KEYS = new Set<StyleAttributeKey>(STYLE_ATTRIBUTE_KEY_LIST);

/** Stable 1-based numeric ID for each style attribute key. Used as the `id` component in the `layerSettings` compound PK. */
export const STYLE_ATTRIBUTE_KEY_ID = new Map<StyleAttributeKey, number>(
    STYLE_ATTRIBUTE_KEY_LIST.map((key, i) => [key, i + 1]),
);

export function isSupportedStyleAttributeKey(value: string): value is StyleAttributeKey {
    return SUPPORTED_STYLE_ATTRIBUTE_KEYS.has(value as StyleAttributeKey);
}

const STYLE_TYPE_LIST: StyleType[] = [
    "Boolean",
    "Integer",
    "Color",
    "Pixels",
    "PointShapeEnum",
    "PolygonIDShapeEnum",
    "StrokeStyleEnum",
    "FillStyleEnum",
    "OverlapLayoutEnum",
    "PlacementEnum",
    "FontWeightEnum",
    "LineArrowStartEnum",
    "LineArrowEndEnum",
    "LineArrowMidEnum",
];

export const SUPPORTED_STYLE_TYPES = new Set<StyleType>(STYLE_TYPE_LIST);

export function isSupportedStyleType(value: string): value is StyleType {
    return SUPPORTED_STYLE_TYPES.has(value as StyleType);
}

/**
 * Stable numeric ID for the synthesized "Point Label Enum Values" `layerSettingsSetup` row.
 * Lives outside the 1-based STYLE_ATTRIBUTE_KEY_ID range (max=57) so it never collides.
 * Do NOT add "PointLabelEnum" to STYLE_TYPE_LIST — providers must not emit this type.
 */
export const POINT_LABEL_ENUM_VALUES_SETUP_ID = 1000;
