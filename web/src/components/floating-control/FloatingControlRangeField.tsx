import { useState } from "react";

interface FloatingControlRangeFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** Inclusive lower bound for clamping. */
    min?: number;
    /** Inclusive upper bound for clamping. */
    max?: number;
    placeholder?: string;
    /** Error message to display with icon tooltip; null or empty means no error. */
    error?: string | null;
    /** Randomly picked value from the range, shown inline after generation as 'range (→ picked)'. */
    pickedValue?: number | null;
    onFocus?: () => void;
    onBlur?: () => void;
    disabled?: boolean;
}

/** Parse the raw string into a resolved value for external use.
 *  Returns [lo, hi] for ranges, a single number for exact values, or undefined when blank/invalid. */
export function parseRangeFieldValue(raw: string | undefined): number | [number, number] | undefined {
    if (!raw) return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const rangeMatch = trimmed.match(/^(-?\d+)\.\.(-?\d+)$/);
    if (rangeMatch) {
        const a = parseInt(rangeMatch[1]!, 10);
        const b = parseInt(rangeMatch[2]!, 10);
        if (isFinite(a) && isFinite(b)) return [a, b];
    }
    const n = parseInt(trimmed, 10);
    if (isFinite(n)) return n;
    return undefined;
}

export default function FloatingControlRangeField({
    label,
    value,
    onChange,
    min,
    max,
    placeholder,
    error,
    pickedValue,
    onFocus,
    onBlur,
    disabled = false,
}: FloatingControlRangeFieldProps) {
    const [isFocused, setIsFocused] = useState(false);

    function clamp(n: number): number {
        if (min !== undefined && n < min) return min;
        if (max !== undefined && n > max) return max;
        return n;
    }

    function handleBlur() {
        setIsFocused(false);
        onBlur?.();
        const trimmed = value.trim();
        if (!trimmed) return;

        // Try range syntax: N..M
        const rangeMatch = trimmed.match(/^(-?\d+)\.\.(-?\d+)$/);
        if (rangeMatch) {
            let lo = clamp(parseInt(rangeMatch[1]!, 10));
            let hi = clamp(parseInt(rangeMatch[2]!, 10));
            if (lo > hi) [lo, hi] = [hi, lo];
            onChange(`${lo}..${hi}`);
            return;
        }

        // Try single integer (strict match only)
        if (/^-?\d+$/.test(trimmed)) {
            const n = parseInt(trimmed, 10);
            onChange(String(clamp(n)));
            return;
        }

        // Invalid/incomplete input is preserved as typed (do not auto-fix on blur)
    }

    return (
        <div className="flex items-center gap-2 px-3 h-8">
            <div className="w-29/50 shrink-0 flex items-center gap-1 min-w-0">
                <span className="text-xs text-gray-500 shrink-0 truncate select-none">{label}</span>
                <span className="flex-1 min-w-0 h-1 bg-[radial-gradient(circle,#d1d5db_1.5px,transparent_1.5px)] bg-size-[10px_10px] bg-repeat-x bg-center" />
                {error && (
                    <span
                        className="shrink-0 flex items-center cursor-default transition-colors text-red-500 hover:text-red-600"
                        title={error}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
                    </span>
                )}
            </div>
            <div className="relative flex-1 min-w-0">
                <input
                    type="text"
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    disabled={disabled}
                    onFocus={() => {
                        setIsFocused(true);
                        onFocus?.();
                    }}
                    onBlur={handleBlur}
                    className={`w-full border rounded bg-white text-xs px-2 h-6 focus:outline-none transition-colors placeholder:text-gray-400 placeholder:italic ${isFocused ? "border-teal-700" : "border-gray-300"
                        } ${disabled ? "text-gray-400 cursor-not-allowed opacity-50" : "text-gray-900"}`}
                />
                {pickedValue !== null && pickedValue !== undefined && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 italic pointer-events-none whitespace-nowrap">
                        (→ {pickedValue})
                    </span>
                )}
            </div>
        </div>
    );
}
