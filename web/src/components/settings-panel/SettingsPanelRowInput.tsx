import { useId } from "react";
import SettingsPanelRow from "./SettingsPanelRow";

interface SettingsPanelInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    inputMode?: "text" | "decimal";
    placeholder?: string;
    /** Shown under the field; the field is marked invalid. */
    error?: string;
}

export default function SettingsPanelInput({
    label,
    value,
    onChange,
    disabled = false,
    inputMode = "text",
    placeholder,
    error,
}: SettingsPanelInputProps) {
    const errorId = useId();
    return (
        <SettingsPanelRow label={label}>
            <div className="min-w-0 flex-1">
                <input
                    type="text"
                    inputMode={inputMode}
                    aria-label={label}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    className={`h-8 w-full rounded-lg border bg-page px-2.5 text-sm text-fg outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${error ? "border-danger" : "border-line-strong"}`}
                />
                {error && (
                    <p id={errorId} className="mt-1 text-xs text-danger">
                        {error}
                    </p>
                )}
            </div>
        </SettingsPanelRow>
    );
}
