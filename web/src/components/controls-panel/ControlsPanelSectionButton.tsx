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
    "text-fg bg-surface border-line-strong hover:border-line-strong hover:bg-page active:bg-raised disabled:text-faint disabled:border-line disabled:bg-surface disabled:cursor-not-allowed";
  const dangerStyles =
    "text-danger bg-surface border-danger hover:border-danger hover:bg-danger-soft active:bg-danger-soft disabled:text-danger disabled:border-danger disabled:bg-surface disabled:cursor-not-allowed";

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
