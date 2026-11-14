// ─── Resolved Layer Style Interfaces ─────────────────────────────────────────
//
// These interfaces represent the fully resolved rendering parameters derived
// from a layer's LayerSettingView[] array. They are the output of the
// resolveLayerStyle utilities and the direct input to type-specific renderers.
//
// Enum string values are preserved as-is from the provider spec (e.g. "solid",
// "dashed", "circle"). Numeric pixel values are parsed from their serialised
// string form. Font weight values are CSS numeric strings (e.g. "400", "700").

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
