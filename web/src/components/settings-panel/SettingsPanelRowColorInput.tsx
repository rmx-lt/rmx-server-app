import { useState } from "react";
import { Sketch } from "@uiw/react-color";
import { useClickOutside } from "../../hooks/useClickOutside";
import SettingsPanelRow from "./SettingsPanelRow";

interface SettingsPanelColorInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

export default function SettingsPanelColorInput({
    label,
    value,
    onChange,
    disabled = false,
}: SettingsPanelColorInputProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useClickOutside<HTMLDivElement>(isOpen, () => setIsOpen(false));

    return (
        <SettingsPanelRow label={label}>
            <div
                ref={containerRef}
                className={`relative flex-1 min-w-0 flex items-center border border-gray-300 rounded bg-white h-6 ${disabled ? "opacity-50" : ""}`}
            >
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    className="flex-1 min-w-0 text-xs px-2 bg-transparent outline-none text-gray-700"
                />
                <button
                    type="button"
                    aria-label="Pick color"
                    disabled={disabled}
                    onClick={() => !disabled && setIsOpen((prev) => !prev)}
                    className="w-5 h-3.5 mr-1.5 border border-gray-300 shrink-0 cursor-pointer disabled:cursor-not-allowed focus:outline-none"
                    style={{ background: value || "#ffffff" }}
                />
                {isOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50">
                        <Sketch
                            color={value}
                            onChange={(c) => onChange(c.hexa)}
                        />
                    </div>
                )}
            </div>
        </SettingsPanelRow>
    );
}
