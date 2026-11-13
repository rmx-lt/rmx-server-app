import { useState } from "react";
import type { LayerSettingView } from "@/data/local/layerTypes";
import type { PointLabelColorEntry } from "@/data/local/serviceTypes";
import { LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";
import SettingsPanelRowInput from "@/components/settings-panel/SettingsPanelRowInput";
import SettingsPanelRowColorInput from "@/components/settings-panel/SettingsPanelRowColorInput";
import SettingsPanelRowToggle from "@/components/settings-panel/SettingsPanelRowToggle";
import SettingsPanelRowSelect from "@/components/settings-panel/SettingsPanelRowSelect";
import { STYLE_TYPE_ENUM_OPTIONS } from "@/config/layers/styleTypeEnumValues";

// ─── Param tooltips ───────────────────────────────────────────────────────────
const PARAM_TOOLTIPS: Partial<Record<string, string>> = {
    [LAYER_PARAM_KEY.SHOW_VERTEX_IDS]: "Vertex IDs are visible only when the Select tool is active",
};

// ─── Enum color helpers ───────────────────────────────────────────────────────
function parseEnumMapping(value: string): PointLabelColorEntry[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        if (
            Array.isArray(parsed) &&
            parsed.length > 0 &&
            typeof (parsed[0] as { value?: unknown }).value === "string"
        ) {
            return parsed as PointLabelColorEntry[];
        }
    } catch { /* not JSON — fall through */ }
    // Fallback: old comma-separated labels with no colors yet
    return value.split(",").map((v) => ({ value: v.trim(), color: null })).filter((e) => e.value.length > 0);
}

// ─── Point Label Enum Colors collapsible group ────────────────────────────────
interface PointLabelEnumColorsGroupProps {
    param: LayerSettingView;
    disabled: boolean;
    onParamChange: (name: string, value: string) => void;
}

function PointLabelEnumColorsGroup({ param, disabled, onParamChange }: PointLabelEnumColorsGroupProps) {
    const [expanded, setExpanded] = useState(true);
    const entries = parseEnumMapping(param.value);

    if (entries.length === 0) return null;

    function handleColorChange(index: number, color: string) {
        const updated = entries.map((e, i) => (i === index ? { ...e, color } : e));
        onParamChange(param.key, JSON.stringify(updated));
    }

    return (
        <div>
            <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1 mt-0.5 text-left hover:bg-gray-100 transition-colors"
                onClick={() => setExpanded((prev) => !prev)}
            >
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider select-none whitespace-nowrap">
                    Point Label Enum Colors
                </span>
                <div className="flex-1 h-px bg-gray-200" />
                <span
                    className="material-symbols-outlined text-gray-400 shrink-0 transition-transform duration-150"
                    style={{ fontSize: 14, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                >
                    expand_more
                </span>
            </button>
            {expanded && entries.map((entry, idx) => (
                <SettingsPanelRowColorInput
                    key={entry.value}
                    label={entry.value}
                    value={entry.color ?? ""}
                    disabled={disabled}
                    onChange={(v) => handleColorChange(idx, v)}
                />
            ))}
        </div>
    );
}

// ─── Individual setting field ─────────────────────────────────────────────────
interface SettingFieldProps {
    param: LayerSettingView;
    disabled: boolean;
    onParamChange: (name: string, value: string) => void;
}

function SettingField({ param, disabled, onParamChange }: SettingFieldProps) {
    const { key, value, styleType } = param;

    switch (styleType) {
        case "Boolean":
            return (
                <SettingsPanelRowToggle
                    label={key}
                    value={value === "true"}
                    disabled={disabled}
                    tooltip={PARAM_TOOLTIPS[key]}
                    onChange={(v) => onParamChange(key, String(v))}
                />
            );
        case "Integer":
        case "Pixels":
            return (
                <SettingsPanelRowInput
                    label={key}
                    value={value}
                    type="number"
                    min={0}
                    disabled={disabled}
                    onChange={(v) => onParamChange(key, v)}
                />
            );
        case "Color":
            return (
                <SettingsPanelRowColorInput
                    label={key}
                    value={value}
                    disabled={disabled}
                    onChange={(v) => onParamChange(key, v)}
                />
            );
        case "PointLabelEnum":
            // Rendered by PointLabelEnumColorsGroup — skip inline
            return null;
        default: {
            const enumOptions = STYLE_TYPE_ENUM_OPTIONS[styleType];
            if (enumOptions != null) {
                return (
                    <SettingsPanelRowSelect
                        label={key}
                        value={value}
                        options={enumOptions}
                        disabled={disabled}
                        onChange={(v) => onParamChange(key, v)}
                    />
                );
            }
            // String and any future unknown styleTypes fall back to text input
            return (
                <SettingsPanelRowInput
                    label={key}
                    value={value}
                    disabled={disabled}
                    onChange={(v) => onParamChange(key, v)}
                />
            );
        }
    }
}

// ─── Collapsible style subgroup section ───────────────────────────────────────
interface StyleSubgroupSectionProps {
    section: SettingsSectionData;
    disabled: boolean;
}

function StyleSubgroupSection({ section, disabled }: StyleSubgroupSectionProps) {
    const [expanded, setExpanded] = useState(true);

    const showHeader = section.showHeader !== false;
    const visibleParams = section.settings.filter((p) => p.key !== LAYER_PARAM_KEY.VISIBLE && p.styleType !== "PointLabelEnum");
    const enumParam = section.settings.find((p) => p.styleType === "PointLabelEnum");

    const hasContent = visibleParams.length > 0 || enumParam != null;
    if (!hasContent) return null;

    const fields = (
        <>
            {visibleParams.map((param) => (
                <SettingField
                    key={param.key}
                    param={param}
                    disabled={disabled}
                    onParamChange={section.onParamChange}
                />
            ))}
            {enumParam != null && (
                <PointLabelEnumColorsGroup
                    param={enumParam}
                    disabled={disabled}
                    onParamChange={section.onParamChange}
                />
            )}
        </>
    );

    if (!showHeader) {
        return <div>{fields}</div>;
    }

    return (
        <div>
            <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1 mt-0.5 text-left hover:bg-gray-100 transition-colors"
                onClick={() => setExpanded((prev) => !prev)}
            >
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider select-none whitespace-nowrap">
                    {section.label}
                </span>
                <div className="flex-1 h-px bg-gray-200" />
                <span
                    className="material-symbols-outlined text-gray-400 shrink-0 transition-transform duration-150"
                    style={{ fontSize: 14, transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                >
                    expand_more
                </span>
            </button>
            {expanded && fields}
        </div>
    );
}

// ─── Section ──────────────────────────────────────────────────────────────────
export interface SettingsSectionData {
    label: string;
    settings: LayerSettingView[];
    onParamChange: (name: string, value: string) => void;
    /** When false, renders the section flat without a collapsible header. Defaults to true. */
    showHeader?: boolean;
}

// ─── Panel ────────────────────────────────────────────────────────────────────
interface LayerSettingsPanelProps {
    sections: SettingsSectionData[];
    disabled?: boolean;
}

export default function LayerSettingsPanel({ sections, disabled = false }: LayerSettingsPanelProps) {
    if (sections.length === 0) return null;

    return (
        <div className="border-t border-gray-100 bg-gray-50 py-1">
            {sections.map((section) => (
                <StyleSubgroupSection
                    key={section.label}
                    section={section}
                    disabled={disabled}
                />
            ))}
        </div>
    );
}
