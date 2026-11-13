import { useState } from "react";

interface FloatingControlNumberFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type: "int" | "decimal";
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    disabled?: boolean;
}

export default function FloatingControlNumberField({
    label,
    value,
    onChange,
    type,
    min,
    max,
    step,
    placeholder,
    disabled = false,
}: FloatingControlNumberFieldProps) {
    const [isFocused, setIsFocused] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const effectiveStep = step ?? (type === "decimal" ? 0.1 : 1);
    const showSpinners = (isFocused || isHovered) && !disabled;

    function increment() {
        const next = parseFloat((Number(value || "0") + effectiveStep).toFixed(10));
        const constrained = max !== undefined && next > max ? max : next;
        onChange(type === "int" ? String(Math.round(constrained)) : String(constrained));
    }

    function decrement() {
        const next = parseFloat((Number(value || "0") - effectiveStep).toFixed(10));
        const floored = min !== undefined && next < min ? min : next;
        onChange(type === "int" ? String(Math.round(floored)) : String(floored));
    }

    function handleBlur() {
        setIsFocused(false);
        if (value === "") return;
        let num = Number(value);
        if (isNaN(num)) {
            onChange(min !== undefined ? String(min) : "0");
            return;
        }
        if (type === "int") {
            num = Math.round(num);
        }
        if (min !== undefined && num < min) num = min;
        if (max !== undefined && num > max) num = max;
        onChange(String(num));
    }

    return (
        <div
            className="flex items-center gap-2 px-3 h-8"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="w-29/50 shrink-0 flex items-center gap-1 min-w-0">
                <span className="text-xs text-gray-500 truncate select-none">{label}</span>
                <span className="flex-1 min-w-0 h-1 bg-[radial-gradient(circle,#d1d5db_1.5px,transparent_1.5px)] bg-size-[10px_10px] bg-repeat-x bg-center" />
            </div>
            <div className="relative flex-1 min-w-0">
                <input
                    type="number"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    step={effectiveStep}
                    min={min}
                    max={max}
                    placeholder={placeholder}
                    disabled={disabled}
                    onFocus={() => setIsFocused(true)}
                    onBlur={handleBlur}
                    className={`w-full border rounded bg-white text-xs px-2 h-6 focus:outline-none transition-colors pr-5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none placeholder:text-gray-400 placeholder:italic ${isFocused ? "border-teal-700" : "border-gray-300"
                        } ${disabled ? "text-gray-400 cursor-not-allowed opacity-50" : "text-gray-900"}`}
                />
                {showSpinners && (
                    <div className="absolute right-px top-1/2 -translate-y-1/2 flex flex-col w-3 pt-0.5 mr-1.5">
                        <button
                            type="button"
                            tabIndex={-1}
                            disabled={disabled}
                            onMouseDown={(e) => { e.preventDefault(); increment(); }}
                            className="flex items-center justify-center text-gray-400 hover:text-gray-700 active:text-teal-700 cursor-pointer"
                            style={{ height: 10 }}
                        >
                            <span className="material-symbols-outlined leading-none" style={{ fontSize: 14 }}>expand_less</span>
                        </button>
                        <button
                            type="button"
                            tabIndex={-1}
                            disabled={disabled}
                            onMouseDown={(e) => { e.preventDefault(); decrement(); }}
                            className="flex items-center justify-center text-gray-400 hover:text-gray-700 active:text-teal-700 cursor-pointer"
                            style={{ height: 10 }}
                        >
                            <span className="material-symbols-outlined leading-none" style={{ fontSize: 14 }}>expand_more</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
