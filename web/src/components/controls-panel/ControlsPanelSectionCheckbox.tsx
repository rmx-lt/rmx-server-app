import type { ControlsPanelSectionCheckboxProps } from "@/components/controls-panel/controlsPanelTypes";

export default function ControlsPanelSectionCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
}: ControlsPanelSectionCheckboxProps) {
  return (
    <label
      className={`flex items-center gap-3 mx-3 my-1 border rounded bg-white px-3 py-1.5 select-none transition-colors ${disabled
        ? "opacity-50 cursor-not-allowed border-gray-300"
        : "cursor-pointer border-gray-300 hover:border-gray-400"
        }`}
    >
      <span className={`text-sm flex-1 ${disabled ? "text-gray-400" : "text-gray-700"}`}>
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className={`w-4 h-4 rounded border-gray-300 accent-teal-600 focus:ring-teal-700 ${disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
      />
    </label>
  );
}
