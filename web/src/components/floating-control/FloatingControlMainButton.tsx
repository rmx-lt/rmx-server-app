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
            className="mx-3 my-0.5 px-2 py-0.5 border border-accent rounded text-xs font-medium text-on-accent bg-accent hover:bg-accent-hover hover:border-accent-hover active:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer select-none focus:outline-none"
        >
            {label}
        </button>
    );
}
