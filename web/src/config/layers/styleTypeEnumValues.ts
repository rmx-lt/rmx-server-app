import type { StyleType } from "@/data/local/serviceTypes";
import type { SettingsPanelSelectOption } from "@/components/settings-panel/SettingsPanelRowSelect";

const NONE: SettingsPanelSelectOption = { value: "", label: "" };

/**
 * Maps each enum StyleType to its ordered list of select options.
 * The leading "— none —" entry (value: "") represents a null/inactive default.
 * Values match the serialised strings emitted and accepted by the provider API.
 * Labels are human-readable display strings.
 */
export const STYLE_TYPE_ENUM_OPTIONS: Partial<Record<StyleType, SettingsPanelSelectOption[]>> = {
    PointShapeEnum: [
        NONE,
        { value: "circle", label: "Circle" },
        { value: "square", label: "Square" },
        { value: "diamond", label: "Diamond" },
        { value: "cross", label: "Cross" },
        { value: "triangle", label: "Triangle" },
    ],

    PolygonIDShapeEnum: [
        NONE,
        { value: "circle", label: "Circle" },
        { value: "square", label: "Square" },
        { value: "diamond", label: "Diamond" },
        { value: "cross", label: "Cross" },
        { value: "triangle", label: "Triangle" },
    ],

    StrokeStyleEnum: [
        NONE,
        { value: "solid", label: "Solid" },
        { value: "dashed", label: "Dashed" },
        { value: "dotted", label: "Dotted" },
    ],

    FillStyleEnum: [
        NONE,
        { value: "solid", label: "Solid" },
        { value: "hatched", label: "Hatched" },
    ],

    OverlapLayoutEnum: [
        NONE,
        { value: "grid", label: "Grid" },
    ],

    PlacementEnum: [
        NONE,
        { value: "inside", label: "Inside" },
        { value: "outside-left", label: "Outside Left" },
        { value: "outside-right", label: "Outside Right" },
        { value: "outside-top", label: "Outside Top" },
        { value: "outside-bottom", label: "Outside Bottom" },
    ],

    FontWeightEnum: [
        NONE,
        { value: "100", label: "100" },
        { value: "200", label: "200" },
        { value: "300", label: "300" },
        { value: "400", label: "400" },
        { value: "500", label: "500" },
        { value: "600", label: "600" },
        { value: "700", label: "700" },
        { value: "800", label: "800" },
        { value: "900", label: "900" },
    ],

    LineArrowStartEnum: [
        NONE,
        { value: "line_start_arrow", label: "Arrow" },
        { value: "line_start_arrow_notch", label: "Arrow Notch" },
    ],

    LineArrowEndEnum: [
        NONE,
        { value: "line_end_arrow", label: "Arrow" },
        { value: "line_end_arrow_notch", label: "Arrow Notch" },
    ],

    LineArrowMidEnum: [
        NONE,
        { value: "line_start_arrow", label: "Arrow Start" },
        { value: "line_start_arrow_notch", label: "Arrow Start Notch" },
        { value: "line_end_arrow", label: "Arrow End" },
        { value: "line_end_arrow_notch", label: "Arrow End Notch" },
    ],
};
