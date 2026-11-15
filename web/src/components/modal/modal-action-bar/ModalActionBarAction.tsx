import { useState, useRef, useEffect } from "react";
import ModalPopUp from "@/components/modal/modal-pop-up/ModalPopUp";

export type ModalActionStatus = "loading" | "success" | "warning" | "error";

interface StatusIconConfig {
    icon: string;
    colorClass: string;
    label: string;
}

const STATUS_CONFIG: Record<ModalActionStatus, StatusIconConfig> = {
    loading: { icon: "sync", colorClass: "text-faint", label: "Loading" },
    success: { icon: "check_circle", colorClass: "text-ok", label: "Success" },
    warning: { icon: "warning", colorClass: "text-warn", label: "Warning" },
    error: { icon: "error", colorClass: "text-danger", label: "Error" },
};

interface StatusSectionProps {
    status?: ModalActionStatus;
    message?: string;
}

function StatusSection({ status, message }: StatusSectionProps) {
    const [copied, setCopied] = useState(false);
    const copyResetTimeoutRef = useRef<number | null>(null);

    const isIdle = !status;
    const cfg = status ? STATUS_CONFIG[status] : null;
    const triggerColorClass = cfg?.colorClass ?? "text-faint";
    const triggerIcon = cfg?.icon ?? "info";
    const headerColorClass = cfg?.colorClass ?? "text-faint";
    const headerLabel = cfg?.label ?? "Info";

    useEffect(() => {
        return () => {
            if (copyResetTimeoutRef.current !== null) {
                window.clearTimeout(copyResetTimeoutRef.current);
            }
        };
    }, []);

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!message) return;

        await navigator.clipboard.writeText(message);
        setCopied(true);

        if (copyResetTimeoutRef.current !== null) {
            window.clearTimeout(copyResetTimeoutRef.current);
        }

        copyResetTimeoutRef.current = window.setTimeout(() => {
            setCopied(false);
            copyResetTimeoutRef.current = null;
        }, 3000);
    };

    return (
        <ModalPopUp
            disabled={isIdle}
            containerClassName="self-stretch flex items-center"
            notchFillClassName="border-b-gray-50"
            trigger={({ isOpen }) => (
                <>
                    {/* Divider */}
                    <span className="w-px self-stretch bg-pressed" />

                    {/* Trigger — idle shows a muted info icon with simple native tooltip */}
                    <button
                        type="button"
                        tabIndex={-1}
                        title={isIdle ? "Action status will appear here after running" : undefined}
                        className={`flex items-center justify-center w-7 h-full transition-colors
                            ${isIdle
                                ? "text-faint cursor-default"
                                : `cursor-pointer hover:bg-hover ${triggerColorClass} ${isOpen ? "bg-hover" : ""}`
                            }`}
                    >
                        <span
                            className={`material-symbols-outlined${status === "loading" ? " animate-spin [animation-direction:reverse]" : ""}`}
                            style={{ fontSize: 15 }}
                        >
                            {isIdle ? "info" : triggerIcon}
                        </span>
                    </button>
                </>
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-line bg-page shrink-0">
                <span className={`font-semibold capitalize tracking-wide ${headerColorClass}`}>{headerLabel}</span>
                <button
                    type="button"
                    onClick={handleCopy}
                    title={copied ? "Copied" : "Copy to clipboard"}
                    className={`flex items-center transition-colors cursor-pointer ${copied ? "text-ok" : "text-faint hover:text-muted"}`}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                        {copied ? "check" : "content_copy"}
                    </span>
                </button>
            </div>
            {/* Body */}
            <div className="overflow-y-auto p-2.5 whitespace-pre-wrap wrap-break-word leading-relaxed">
                {message ?? <span className="text-faint italic">No details available.</span>}
            </div>
        </ModalPopUp>
    );
}

interface ModalActionProps {
    icon: string;
    label: string;
    onClick: () => void;
    showStatusSection?: boolean;
    disabled?: boolean;
    loading?: boolean;
    status?: ModalActionStatus;
    statusMessage?: string;
}

export default function ModalActionBarAction({
    icon,
    label,
    onClick,
    showStatusSection = true,
    disabled = false,
    loading = false,
    status,
    statusMessage,
}: ModalActionProps) {
    return (
        <div className="inline-flex items-stretch border border-line-strong rounded text-sm text-fg select-none">
            {/* Main action button */}
            <button
                type="button"
                onClick={() => { if (disabled || loading) return; onClick(); }}
                disabled={disabled}
                className={`flex items-center gap-0 transition-colors cursor-pointer group
                    ${disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : ""}
                    ${loading ? "pointer-events-none" : "hover:bg-hover active:bg-pressed"}
                `}
            >
                {/* Icon box */}
                <span className={`flex items-center justify-center w-8 h-8 bg-raised transition-colors shrink-0 ${!disabled && !loading ? "group-hover:bg-hover group-active:bg-pressed" : ""}`}>
                    <span className="material-symbols-outlined text-accent transition-colors" style={{ fontSize: 18 }}>
                        {loading ? "hourglass_empty" : icon}
                    </span>
                </span>

                {/* Label */}
                <span className="px-1 pr-3 whitespace-nowrap group-active:text-fg transition-colors">{label}</span>
            </button>

            {showStatusSection ? <StatusSection status={status} message={statusMessage} /> : null}
        </div>
    );
}
