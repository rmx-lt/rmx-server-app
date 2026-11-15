interface ModalFooterButtonProps {
    onClick: () => void;
    variant?: "default" | "primary" | "danger";
    disabled?: boolean;
    children: React.ReactNode;
}

export default function ModalFooterButton({
    onClick,
    variant = "default",
    disabled = false,
    children,
}: ModalFooterButtonProps) {
    const styles =
        variant === "primary"
            ? "border border-accent bg-accent text-on-accent hover:bg-accent-hover hover:border-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
            : variant === "danger"
                ? "border border-line-strong text-danger hover:bg-danger hover:text-on-accent hover:border-danger disabled:opacity-40 disabled:cursor-not-allowed"
                : "border border-line-strong text-fg hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed";

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`px-3 py-1 rounded font-medium text-sm transition-colors cursor-pointer ${styles}`}
        >
            {children}
        </button>
    );
}
