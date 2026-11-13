import { useState } from "react";
import type { StyleAttributeGroup } from "@/data/local/serviceTypes";
import type { LayerRecord, LayerSettingView } from "@/data/local/layerTypes";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";
import LayerSettingsPanel, { type SettingsSectionData } from "@/features/inspector/components/calc-layers-section/LayerSettingsPanel";

const GROUP_ORDER: StyleAttributeGroup[] = ["general", "point", "startPoint", "endPoint", "startEndPoint", "line", "polygon"];

const GROUP_LABELS: Record<StyleAttributeGroup, string> = {
    general: "General",
    point: "Point Styles",
    startPoint: "Start Point",
    endPoint: "End Point",
    startEndPoint: "Start & End Point",
    line: "Line Styles",
    polygon: "Polygon Styles",
};

interface LayerRowProps {
    layer: LayerRecord;
    settings: LayerSettingView[];
    isFirst: boolean;
    isLast: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onVisibilityChange: (visible: boolean) => void;
    onParamChange: (name: string, value: string) => void;
}

export default function LayerRow({
    layer,
    settings,
    isFirst,
    isLast,
    onMoveUp,
    onMoveDown,
    onVisibilityChange,
    onParamChange,
}: LayerRowProps) {
    const [expanded, setExpanded] = useState(false);

    const visible = settings.find((p) => p.key === LAYER_PARAM_KEY.VISIBLE)?.value === "true";

    return (
        <div>
            {/* Row: visibility + name + controls */}
            <div className="flex items-center gap-2 px-4 py-2">
                <input
                    type="checkbox"
                    checked={visible}
                    onChange={(e) => onVisibilityChange(e.target.checked)}
                    className="h-3.5 w-3.5 shrink-0 accent-teal-600 cursor-pointer"
                />
                <span className="flex-1 truncate text-sm text-gray-800" title={layer.label}>
                    {layer.label}
                </span>
                {/* Z-order controls */}
                <div className="flex shrink-0 gap-0.5">
                    <button
                        type="button"
                        disabled={isFirst}
                        onClick={onMoveUp}
                        title="Move layer up"
                        className="flex items-center justify-center rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                            arrow_upward
                        </span>
                    </button>
                    <button
                        type="button"
                        disabled={isLast}
                        onClick={onMoveDown}
                        title="Move layer down"
                        className="flex items-center justify-center rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                            arrow_downward
                        </span>
                    </button>
                </div>
                {/* Expand / collapse settings */}
                <button
                    type="button"
                    onClick={() => setExpanded((prev) => !prev)}
                    title={expanded ? "Collapse settings" : "Expand settings"}
                    className="flex items-center justify-center rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                >
                    <span
                        className="material-symbols-outlined transition-transform duration-150"
                        style={{ fontSize: 14, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                    >
                        expand_more
                    </span>
                </button>
            </div>

            {/* Settings panel */}
            {expanded && (
                <LayerSettingsPanel
                    sections={buildSections(layer, settings, onParamChange)}
                />
            )}
        </div>
    );
}

function buildSections(
    layer: LayerRecord,
    settings: LayerSettingView[],
    onParamChange: (name: string, value: string) => void,
): SettingsSectionData[] {
    if (layer.id === LAYER_ID.COVERAGE_GRID && layer.algorithmId === 0 && layer.providerId === 0) {
        const general = settings.filter((p) => p.styleGroup === "general");
        const style = settings.filter((p) => p.styleGroup !== "general" && p.key !== LAYER_PARAM_KEY.VISIBLE);

        const sections: SettingsSectionData[] = [];
        if (general.length > 0) sections.push({ label: "General", settings: general, onParamChange });
        if (style.length > 0) sections.push({ label: "Style", settings: style, onParamChange });
        return sections;
    }

    const sections: SettingsSectionData[] = [];

    // Internal params with no style group render flat (no collapsible header)
    const ungrouped = settings.filter((p) => p.styleGroup == null && p.key !== LAYER_PARAM_KEY.VISIBLE);
    if (ungrouped.length > 0) {
        sections.push({ label: "", settings: ungrouped, onParamChange, showHeader: false });
    }

    // API style subgroups render as collapsible sections
    for (const group of GROUP_ORDER) {
        const grouped = settings.filter((p) => p.styleGroup === group);
        if (grouped.length > 0) {
            sections.push({ label: GROUP_LABELS[group], settings: grouped, onParamChange });
        }
    }

    return sections;
}
