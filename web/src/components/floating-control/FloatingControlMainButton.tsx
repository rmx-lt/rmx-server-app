interface FloatingControlMainButtonProps {
    label: string;
    onClick: () => void;
    disabled?: boolean;
}

export default function FloatingControlMainButton({
    label,
    onClick,
    disabled = false,
}: FloatingControlMainButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="mx-3 my-0.5 px-2 py-0.5 border border-teal-600 rounded text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 hover:border-teal-700 active:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer select-none focus:outline-none"
        >
            {label}
        </button>
    );
}
