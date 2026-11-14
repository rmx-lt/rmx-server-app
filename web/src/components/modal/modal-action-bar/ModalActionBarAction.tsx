import { useState, useRef, useEffect } from "react";
import ModalPopUp from "@/components/modal/modal-pop-up/ModalPopUp";

export type ModalActionStatus = "loading" | "success" | "warning" | "error";

interface StatusIconConfig {
    icon: string;
    colorClass: string;
    label: string;
}

const STATUS_CONFIG: Record<ModalActionStatus, StatusIconConfig> = {
    loading: { icon: "sync", colorClass: "text-gray-400", label: "Loading" },
    success: { icon: "check_circle", colorClass: "text-green-500", label: "Success" },
    warning: { icon: "warning", colorClass: "text-amber-500", label: "Warning" },
    error: { icon: "error", colorClass: "text-red-500", label: "Error" },
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
    const triggerColorClass = cfg?.colorClass ?? "text-gray-300";
    const triggerIcon = cfg?.icon ?? "info";
    const headerColorClass = cfg?.colorClass ?? "text-gray-400";
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
                    <span className="w-px self-stretch bg-gray-300" />

                    {/* Trigger — idle shows a muted info icon with simple native tooltip */}
                    <button
                        type="button"
                        tabIndex={-1}
                        title={isIdle ? "Action status will appear here after running" : undefined}
                        className={`flex items-center justify-center w-7 h-full transition-colors
                            ${isIdle
                                ? "text-gray-300 cursor-default"
                                : `cursor-pointer hover:bg-gray-200 ${triggerColorClass} ${isOpen ? "bg-gray-200" : ""}`
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
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-200 bg-gray-50 shrink-0">
                <span className={`font-semibold capitalize tracking-wide ${headerColorClass}`}>{headerLabel}</span>
                <button
                    type="button"
                    onClick={handleCopy}
                    title={copied ? "Copied" : "Copy to clipboard"}
                    className={`flex items-center transition-colors cursor-pointer ${copied ? "text-green-500" : "text-gray-400 hover:text-gray-600"}`}
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                        {copied ? "check" : "content_copy"}
                    </span>
                </button>
            </div>
            {/* Body */}
            <div className="overflow-y-auto p-2.5 whitespace-pre-wrap wrap-break-word leading-relaxed">
                {message ?? <span className="text-gray-400 italic">No details available.</span>}
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
        <div className="inline-flex items-stretch border border-gray-300 rounded text-sm text-gray-700 select-none">
            {/* Main action button */}
            <button
                type="button"
                onClick={() => { if (disabled || loading) return; onClick(); }}
                disabled={disabled}
                className={`flex items-center gap-0 transition-colors cursor-pointer group
                    ${disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : ""}
                    ${loading ? "pointer-events-none" : "hover:bg-gray-200 active:bg-gray-300"}
                `}
            >
                {/* Icon box */}
                <span className={`flex items-center justify-center w-8 h-8 bg-gray-100 transition-colors shrink-0 ${!disabled && !loading ? "group-hover:bg-gray-200 group-active:bg-gray-300" : ""}`}>
                    <span className="material-symbols-outlined text-teal-600 transition-colors" style={{ fontSize: 18 }}>
                        {loading ? "hourglass_empty" : icon}
                    </span>
                </span>

                {/* Label */}
                <span className="px-1 pr-3 whitespace-nowrap group-active:text-gray-900 transition-colors">{label}</span>
            </button>

            {showStatusSection ? <StatusSection status={status} message={statusMessage} /> : null}
        </div>
    );
}
