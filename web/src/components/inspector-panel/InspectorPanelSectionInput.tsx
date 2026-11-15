import { useState } from "react";

interface InspectorPanelSectionInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: "text" | "number";
    min?: number;
    max?: number;
    step?: number;
}

export default function InspectorPanelSectionInput({
    label,
    value,
    onChange,
    type = "text",
    min,
    max,
    step,
}: InspectorPanelSectionInputProps) {
    // The text being edited while the input has focus; null shows `value`.
    const [draft, setDraft] = useState<string | null>(null);
    const isFocused = draft !== null;

    function commit(local: string) {
        if (type === "number") {
            const parsed = parseFloat(local);
            if (isNaN(parsed)) return;
            const clamped =
                min !== undefined && parsed < min
                    ? min
                    : max !== undefined && parsed > max
                        ? max
                        : parsed;
            const str = String(clamped);
            if (str !== value) onChange(str);
        } else {
            if (local !== value) onChange(local);
        }
    }

    return (
        <div className="flex items-center gap-2 px-5 py-1">
            <span className="min-w-0 flex-1 truncate text-sm text-fg" title={label}>
                {label}
            </span>
            <input
                type={type}
                value={draft ?? value}
                step={step}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => setDraft(value)}
                onBlur={() => {
                    if (draft !== null) commit(draft);
                    setDraft(null);
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={`w-20 shrink-0 rounded border bg-surface text-sm px-2 py-0.5 text-right text-fg focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${isFocused ? "border-accent-hover" : "border-line-strong"}`}
            />
        </div>
    );
}
