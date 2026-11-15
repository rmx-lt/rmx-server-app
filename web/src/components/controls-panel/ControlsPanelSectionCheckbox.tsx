import type { ControlsPanelSectionCheckboxProps } from "@/components/controls-panel/controlsPanelTypes";

export default function ControlsPanelSectionCheckbox({
  label,
  checked,
  onChange,
  disabled = false,
}: ControlsPanelSectionCheckboxProps) {
  return (
    <label
      className={`flex items-center gap-3 mx-3 my-1 border rounded bg-surface px-3 py-1.5 select-none transition-colors ${disabled
        ? "opacity-50 cursor-not-allowed border-line-strong"
        : "cursor-pointer border-line-strong hover:border-line-strong"
        }`}
    >
      <span className={`text-sm flex-1 ${disabled ? "text-faint" : "text-fg"}`}>
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className={`w-4 h-4 rounded border-line-strong accent-accent focus:ring-accent ${disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
      />
    </label>
  );
}
