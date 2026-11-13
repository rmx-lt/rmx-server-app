import { useState } from "react";
import type { ControlsPanelSectionInputProps } from "@/components/controls-panel/controlsPanelTypes";

export default function ControlsPanelSectionInput({
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  disabled = false,
  placeholder,
  type = "text",
  min,
  max,
}: ControlsPanelSectionInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isEmpty = value === "";
  const isFloated = !isEmpty || isFocused;
  const displayValue = isEmpty && !isFocused ? "" : value;
  const showSpinners = type === "number" && (isFocused || (isHovered && !isEmpty)) && !disabled;

  return (
    <div
      className="relative mx-3 my-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className={`absolute pointer-events-none select-none transition-all duration-150 leading-none ${isFloated
          ? `top-1 left-3 text-xs ${isFocused ? "text-teal-700" : "text-gray-500"}`
          : "top-1/2 -translate-y-1/2 left-3 text-sm text-gray-400"
          }`}
      >
        {label}
      </span>
      <input
        type={type}
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isFocused ? placeholder : undefined}
        min={min}
        max={max}
        onFocus={() => {
          setIsFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setIsFocused(false);
          if (type === "number" && value !== "") {
            const numeric = Number(value);
            if (!isNaN(numeric)) {
              if (min !== undefined && numeric < min) {
                onChange(String(min));
              } else if (max !== undefined && numeric > max) {
                onChange(String(max));
              }
            }
          }
          onBlur?.();
        }}
        disabled={disabled}
        className={`w-full border rounded bg-white text-sm px-3 focus:outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${isFloated ? "pt-5 pb-1" : "py-1.5"
          } ${type === "number" ? "pr-5" : ""
          } ${isFocused ? "border-teal-700" : "border-gray-300"
          } ${disabled ? "text-gray-400 cursor-not-allowed" : "text-gray-900"
          }`}
      />
      {showSpinners && (
        <div className="absolute right-3 top-3.5 bottom-1 flex flex-col rounded overflow-hidden w-4">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              const nextVal = Number(value) + 1;
              const constrained = max !== undefined && nextVal > max ? max : nextVal;
              onChange(String(constrained));
            }}
            className="flex-1 flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-t cursor-pointer active:text-teal-700"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>expand_less</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              const nextVal = Math.max(min ?? -Infinity, Number(value) - 1);
              const constrained = max !== undefined && nextVal > max ? max : nextVal;
              onChange(String(constrained));
            }}
            className="flex-1 flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-b cursor-pointer active:text-teal-700"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>expand_more</span>
          </button>
        </div>
      )}
    </div>
  );
}
