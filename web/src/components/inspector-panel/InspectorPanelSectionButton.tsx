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
            ? "text-teal-700 bg-white border-gray-300 hover:bg-gray-200 active:bg-gray-300 disabled:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
            : "text-gray-600 bg-white border-gray-300 hover:text-gray-900 active:text-gray-800 hover:bg-gray-200 active:bg-gray-300 disabled:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed";

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
