import type { ControlsPanelSectionButtonProps } from "@/components/controls-panel/controlsPanelTypes";

export default function ControlsPanelSectionButton({
  label,
  onClick,
  disabled = false,
  variant = "default",
}: ControlsPanelSectionButtonProps) {
  const baseStyles =
    "w-full mx-3 my-1 px-3 py-1.5 border rounded text-sm font-medium cursor-pointer select-none transition-colors focus:outline-none";
  const defaultStyles =
    "text-gray-700 bg-white border-gray-300 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 disabled:bg-white disabled:cursor-not-allowed";
  const dangerStyles =
    "text-red-600 bg-white border-red-300 hover:border-red-400 hover:bg-red-50 active:bg-red-100 disabled:text-red-300 disabled:border-red-200 disabled:bg-white disabled:cursor-not-allowed";

  const variantStyles = variant === "danger" ? dangerStyles : defaultStyles;
  const className = `${baseStyles} ${variantStyles}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {label}
    </button>
  );
}
