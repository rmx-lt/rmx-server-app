// Types shared by the local database and the canvas layers.

// ─── App Enum Values ──────────────────────────────────────────────────────────

export type AppEnumGroup = "format" | "type" | "coordsystem";

export interface AppEnumValue {
    enumGroup: AppEnumGroup;
    value: string;
    label: string;
}

export type MetadataLayerType = "Point" | "Line" | "Polygon";

export type StyleAttributeKey =
    | "Visible"
    | "Z-Index"
    // Point — Marker Shape
    | "Point Shape"
    | "Point Radius"
    // Point — Overlap
    | "Point Overlap Spacing"
    | "Point Overlap Layout"
    // Point — Border
    | "Point Border Color"
    | "Point Border Width"
    | "Point Border Style"
    // Point — Fill
    | "Point Fill Color"
    // Point — Id Label
    | "Point ID Color"
    | "Point ID Font Size"
    | "Point ID Font Weight"
    | "Point ID Placement"
    | "Point ID Offset"
    // Point — Text Label
    | "Point Label Color"
    | "Point Label Font Size"
    | "Point Label Font Weight"
    | "Point Label Placement"
    | "Point Label Offset"
    // Line — Edge
    | "Line Edge Color"
    | "Line Edge Width"
    | "Line Edge Style"
    // Line — Arrow
    | "Line Arrow Start"
    | "Line Arrow End"
    | "Line Arrow Mid"
    | "Line Arrow Mid Spacing"
    | "Line Arrow Size"
    // Polygon — Edge
    | "Polygon Edge Color"
    | "Polygon Edge Width"
    | "Polygon Edge Style"
    // Polygon — Fill
    | "Polygon Fill Color"
    | "Polygon Fill Style"
    // Polygon — ID
    | "Polygon ID Color"
    | "Polygon ID Font Size"
    | "Polygon ID Font Weight"
    | "Polygon ID Shape"
    | "Polygon ID Radius"
    | "Polygon ID Border Color"
    | "Polygon ID Border Width"
    | "Polygon ID Border Style"
    | "Polygon ID Fill Color"
    | "Polygon ID Placement"
    | "Polygon ID Offset";

export type StyleType =
    | "Boolean"
    | "Integer"
    | "Color"
    | "Pixels"
    | "PointShapeEnum"
    | "PolygonIDShapeEnum"
    | "StrokeStyleEnum"
    | "FillStyleEnum"
    | "OverlapLayoutEnum"
    | "PlacementEnum"
    | "FontWeightEnum"
    | "LineArrowStartEnum"
    | "LineArrowEndEnum"
    | "LineArrowMidEnum"
    | "PointLabelEnum";

/** Which style attribute family a parameter belongs to, mirroring the API's style subgroup fields. */
export type StyleAttributeGroup = "general" | "point" | "startPoint" | "endPoint" | "startEndPoint" | "line" | "polygon";

export interface PointLabelColorEntry {
    value: string;
    color: string | null;
}

/** Item contract for layers with layerType: "Polygon". Each item renders as a filled polygon. */
export interface CanvasPolygonItem {
    id: number;
    /** Polygon vertices in draw order. */
    vertices: { x: number; y: number }[];
    /** Optional centroid used for ID label placement. Falls back to the first vertex if absent. */
    centroidPoint?: { x: number; y: number };
}
