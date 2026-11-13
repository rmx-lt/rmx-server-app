// ─── Resolved Layer Style Interfaces ─────────────────────────────────────────
//
// These interfaces represent the fully resolved rendering parameters derived
// from a layer's LayerSettingView[] array. They are the output of the
// resolveLayerStyle utilities and the direct input to type-specific renderers.
//
// Enum string values are preserved as-is from the provider spec (e.g. "solid",
// "dashed", "circle"). Numeric pixel values are parsed from their serialised
// string form. Font weight values are CSS numeric strings (e.g. "400", "700").

// ─── Line ─────────────────────────────────────────────────────────────────────

export interface ResolvedLineLayerStyle {
    visible: boolean;
    zIndex: number;
    /** Stroke color (hex). */
    stroke: string;
    /** Stroke width in world-space pixels. */
    strokeWidth: number;
    /** Konva dash pattern derived from StrokeStyleEnum. `[]` = solid. */
    dash: number[];
    /** Raw "Line Arrow Start" enum value (e.g. "line_start_arrow" | ""). */
    arrowStart: string;
    /** Raw "Line Arrow End" enum value. */
    arrowEnd: string;
    /** Raw "Line Arrow Mid" enum value. */
    arrowMid: string;
    /** Spacing between repeated mid-arrow decorators in world pixels. */
    arrowMidSpacing: number;
    /** Arrow head size in world pixels. */
    arrowSize: number;
    // ── Per-item point markers (optional; empty pointShape = no markers rendered) ──
    /** Point marker shape. Empty string = no markers rendered. */
    pointShape: string;
    /** Marker radius in world pixels. */
    pointRadius: number;
    // ── Overlap ──
    /** Spacing between stacked points that share the same canvas position. 0 = no spread. */
    pointOverlapSpacing: number;
    /** Overlap layout algorithm (OverlapLayoutEnum). Empty = no spread. */
    pointOverlapLayout: string;
    // ── Border ──
    /** Marker fill color (hex). */
    pointFillColor: string;
    /** Marker border/stroke color (hex). */
    pointBorderColor: string;
    /** Marker border width in world pixels. */
    pointBorderWidth: number;
    /** Konva dash pattern for the marker border. */
    pointBorderDash: number[];
    /** ID text color (hex). Rendered inside the marker when pointIdPlacement is "inside". */
    pointIdColor: string;
    /** ID text font size in pixels. */
    pointIdFontSize: number;
    /** Konva-compatible font weight string. */
    pointIdFontWeight: string;
    /** ID placement (PlacementEnum). "inside" = centered in marker. Empty = no ID rendered. */
    pointIdPlacement: string;
    /** ID text offset in world pixels. */
    pointIdOffset: number;
    /** Label text color (hex). */
    pointLabelColor: string;
    /** Label text font size in pixels. */
    pointLabelFontSize: number;
    /** Konva-compatible font weight string. */
    pointLabelFontWeight: string;
    /** Label placement (PlacementEnum). Empty = no label rendered. */
    pointLabelPlacement: string;
    /** Label offset distance in world pixels. */
    pointLabelOffset: number;
}

// ─── Point ────────────────────────────────────────────────────────────────────

export interface ResolvedPointLayerStyle {
    visible: boolean;
    zIndex: number;
    /** Point marker shape (PointShapeEnum): "circle" | "square" | "diamond" | "cross" | "triangle". */
    shape: string;
    /** Marker radius in world pixels. */
    radius: number;
    // ── Overlap ──
    /** Spacing between stacked points that share the same canvas position. 0 = no spread. */
    overlapSpacing: number;
    /** Overlap layout algorithm (OverlapLayoutEnum). Empty = no spread. */
    overlapLayout: string;
    // ── Border ──
    /** Marker fill color (hex). */
    fillColor: string;
    /** Marker border/stroke color (hex). */
    borderColor: string;
    /** Marker border stroke width in world pixels. */
    borderWidth: number;
    /** Konva dash pattern for the marker border. `[]` = solid. */
    borderDash: number[];
    // ── Id Label ──
    /** ID text color (hex). Rendered at idPlacement relative to the marker. */
    idColor: string;
    /** ID text font size in pixels. */
    idFontSize: number;
    /** Konva-compatible font weight string. */
    idFontWeight: string;
    /** ID placement (PlacementEnum). Empty = no ID rendered. */
    idPlacement: string;
    /** ID text offset in world pixels. */
    idOffset: number;
    // ── Text Label ──
    /** Text label fill color (hex). */
    labelColor: string;
    /** Text label font size in pixels. */
    labelFontSize: number;
    /** Konva-compatible font weight string (e.g. "normal" | "bold" | "600"). */
    labelFontWeight: string;
    /** Label placement (PlacementEnum): "inside" | "outside-left" | "outside-right" | "outside-top" | "outside-bottom" | "". */
    labelPlacement: string;
    /** Offset distance between marker edge and label in world pixels. */
    labelOffset: number;
}

// ─── Polygon result ───────────────────────────────────────────────────────────

export interface ResolvedPolygonResultLayerStyle {
    visible: boolean;
    zIndex: number;
    // ── Corner Vertex ──
    /** Corner vertex marker shape (PointShapeEnum). Empty = no corner markers rendered. */
    vertexShape: string;
    /** Corner vertex marker radius in world pixels. */
    vertexRadius: number;
    /** Corner vertex fill color (hex). */
    vertexFillColor: string;
    /** Corner vertex border color (hex). */
    vertexBorderColor: string;
    /** Corner vertex border width in world pixels. */
    vertexBorderWidth: number;
    /** Konva dash pattern for the corner vertex border. */
    vertexBorderDash: number[];
    /** Corner vertex ID text color (hex). */
    vertexIdColor: string;
    /** Corner vertex ID font size in pixels. */
    vertexIdFontSize: number;
    /** Konva-compatible font weight string. */
    vertexIdFontWeight: string;
    /** Corner vertex ID placement (PlacementEnum). Empty = no ID rendered. */
    vertexIdPlacement: string;
    /** Corner vertex ID offset in world pixels. */
    vertexIdOffset: number;
    /** Edge stroke color (hex). */
    stroke: string;
    /** Edge stroke width in world pixels. */
    strokeWidth: number;
    /** Konva dash pattern for the polygon edge. `[]` = solid. */
    dash: number[];
    /** Fill color (hex, may include alpha). */
    fill: string;
    /** Fill style (FillStyleEnum): "solid" | "hatched" | "". */
    fillStyle: string;
    /** ID badge text color (hex). */
    idColor: string;
    /** ID badge font size in pixels. */
    idFontSize: number;
    /** Konva-compatible font weight string. */
    idFontWeight: string;
    /** ID badge background shape (PolygonIDShapeEnum): "circle" | "square" | "diamond" | "cross" | "triangle" | "". */
    idShape: string;
    /** ID badge background shape radius in world pixels. */
    idRadius: number;
    /** ID badge border color (hex). */
    idBorderColor: string;
    /** ID badge border width in world pixels. */
    idBorderWidth: number;
    /** Konva dash pattern for the ID badge border. */
    idBorderDash: number[];
    /** ID badge background fill color (hex). */
    idFillColor: string;
    /** ID badge placement (PlacementEnum). Empty string means no badge is rendered. */
    idPlacement: string;
    /** ID badge offset from centroid in world pixels. */
    idOffset: number;
}
