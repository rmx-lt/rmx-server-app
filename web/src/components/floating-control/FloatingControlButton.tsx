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
            className="mx-3 my-0.5 px-2 py-0.5 border border-line-strong rounded text-xs font-medium text-fg bg-surface hover:bg-page hover:border-line-strong active:bg-raised disabled:text-faint disabled:border-line disabled:bg-surface disabled:cursor-not-allowed transition-colors cursor-pointer select-none focus:outline-none"
        >
            {label}
        </button>
    );
}
