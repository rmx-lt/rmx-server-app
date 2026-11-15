interface ModalTitleProps {
    title: string;
    onClose: () => void;
}

export default function ModalTitle({ title, onClose }: ModalTitleProps) {
    return (
        <div className="flex items-center justify-between px-5 py-2 select-none">
            <span className="text-sm font-semibold text-fg tracking-wide uppercase">
                {title}
            </span>
            <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center text-faint hover:text-danger transition-colors p-0.5 cursor-pointer"
                title="Close"
            >
                <span className="material-symbols-outlined block" style={{ fontSize: 22 }}>close</span>
            </button>
        </div>
    );
}
