interface FloatingControlButtonProps {
    label: string;
    onClick: () => void;
    disabled?: boolean;
}

export default function FloatingControlButton({
    label,
    onClick,
    disabled = false,
}: FloatingControlButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="mx-3 my-0.5 px-2 py-0.5 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 disabled:bg-white disabled:cursor-not-allowed transition-colors cursor-pointer select-none focus:outline-none"
        >
            {label}
        </button>
    );
}
