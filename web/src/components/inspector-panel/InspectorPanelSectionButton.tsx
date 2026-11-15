interface InspectorPanelSectionButtonProps {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: "default" | "primary";
}

export default function InspectorPanelSectionButton({
    label,
    onClick,
    disabled = false,
    variant = "default",
}: InspectorPanelSectionButtonProps) {
    const variantStyles =
        variant === "primary"
            ? "text-accent bg-surface border-line-strong hover:bg-hover active:bg-pressed disabled:text-faint disabled:opacity-40 disabled:cursor-not-allowed"
            : "text-muted bg-surface border-line-strong hover:text-fg active:text-fg hover:bg-hover active:bg-pressed disabled:text-faint disabled:opacity-40 disabled:cursor-not-allowed";

    return (
        <div className="px-5 py-1">
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={`w-full px-3 py-1 border rounded text-sm font-medium transition-colors focus:outline-none cursor-pointer select-none ${variantStyles}`}
            >
                {label}
            </button>
        </div>
    );
}
