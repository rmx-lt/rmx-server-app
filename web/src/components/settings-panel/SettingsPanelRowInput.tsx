import { useState } from "react";
import SettingsPanelRow from "./SettingsPanelRow";

interface SettingsPanelInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    type?: "text" | "number";
    min?: number;
}

export default function SettingsPanelInput({
    label,
    value,
    onChange,
    disabled = false,
    type = "text",
    min,
}: SettingsPanelInputProps) {
    const [isFocused, setIsFocused] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const showSpinners = type === "number" && (isFocused || isHovered) && !disabled;

    return (
        <SettingsPanelRow
            label={label}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="relative flex-1 min-w-0">
                <input
                    type={type}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    min={min}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => {
                        setIsFocused(false);
                        if (type === "number" && min !== undefined && value !== "") {
                            const numeric = Number(value);
                            if (!isNaN(numeric) && numeric < min) {
                                onChange(String(min));
                            }
                        }
                    }}
                    disabled={disabled}
                    className={`w-full border rounded bg-surface text-xs px-2 h-6 focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${type === "number" ? "pr-5" : ""
                        } ${isFocused ? "border-accent-hover" : "border-line-strong"
                        } ${disabled ? "text-faint cursor-not-allowed opacity-50" : "text-fg"
                        }`}
                />
                {showSpinners && (
                    <div className="absolute right-px top-1/2 -translate-y-1/2 flex flex-col w-3 pt-0.5 mr-1.5">
                        <button
                            type="button"
                            tabIndex={-1}
                            disabled={disabled}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onChange(String(Number(value) + 1));
                            }}
                            className="flex items-center justify-center text-faint hover:text-fg cursor-pointer active:text-accent"
                            style={{ height: 10 }}
                        >
                            <span className="material-symbols-outlined leading-none" style={{ fontSize: 14 }}>expand_less</span>
                        </button>
                        <button
                            type="button"
                            tabIndex={-1}
                            disabled={disabled}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onChange(String(Math.max(min ?? -Infinity, Number(value) - 1)));
                            }}
                            className="flex items-center justify-center text-faint hover:text-fg cursor-pointer active:text-accent"
                            style={{ height: 10 }}
                        >
                            <span className="material-symbols-outlined leading-none" style={{ fontSize: 14 }}>expand_more</span>
                        </button>
                    </div>
                )}
            </div>
        </SettingsPanelRow>
    );
}
