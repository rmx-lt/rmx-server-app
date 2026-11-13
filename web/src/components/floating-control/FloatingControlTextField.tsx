import { useState } from "react";

interface FloatingControlTextFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
}

export default function FloatingControlTextField({
    label,
    value,
    onChange,
    placeholder,
    disabled = false,
}: FloatingControlTextFieldProps) {
    const [isFocused, setIsFocused] = useState(false);

    return (
        <div className="flex items-center gap-2 px-3 h-8">
            <div className="w-29/50 shrink-0 flex items-center gap-1 min-w-0">
                <span className="text-xs text-gray-500 shrink-0 truncate select-none">{label}</span>
                <span className="flex-1 min-w-0 h-1 bg-[radial-gradient(circle,#d1d5db_1.5px,transparent_1.5px)] bg-size-[10px_10px] bg-repeat-x bg-center" />
            </div>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className={`flex-1 min-w-0 border rounded bg-white text-xs px-2 h-6 focus:outline-none transition-colors placeholder:text-gray-400 placeholder:italic ${isFocused ? "border-teal-700" : "border-gray-300"
                    } ${disabled ? "text-gray-400 cursor-not-allowed opacity-50" : "text-gray-900"}`}
            />
        </div>
    );
}
