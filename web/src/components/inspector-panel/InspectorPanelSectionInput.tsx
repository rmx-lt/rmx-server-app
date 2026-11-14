import { useState, useEffect } from "react";

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
    const [local, setLocal] = useState(value);
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
        if (!isFocused) setLocal(value);
    }, [value, isFocused]);

    function commit() {
        if (type === "number") {
            const parsed = parseFloat(local);
            if (isNaN(parsed)) {
                setLocal(value);
                return;
            }
            const clamped =
                min !== undefined && parsed < min
                    ? min
                    : max !== undefined && parsed > max
                        ? max
                        : parsed;
            const str = String(clamped);
            setLocal(str);
            if (str !== value) onChange(str);
        } else {
            if (local !== value) onChange(local);
        }
    }

    return (
        <div className="flex items-center gap-2 px-5 py-1">
            <span className="min-w-0 flex-1 truncate text-sm text-gray-800" title={label}>
                {label}
            </span>
            <input
                type={type}
                value={local}
                step={step}
                onChange={(e) => setLocal(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => {
                    setIsFocused(false);
                    commit();
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={`w-20 shrink-0 rounded border bg-white text-sm px-2 py-0.5 text-right text-gray-900 focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${isFocused ? "border-teal-700" : "border-gray-300"}`}
            />
        </div>
    );
}
