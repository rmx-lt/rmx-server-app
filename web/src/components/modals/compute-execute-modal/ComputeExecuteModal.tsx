import { useEffect, useRef } from "react";
import { useComputeResultStore } from "@/model/useComputeResultStore";
import type { ComputeStatus } from "@/model/useComputeResultStore";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";

const MIN_OPEN_MS = 500;

interface PhaseConfig {
    icon: string;
    iconColorClass: string;
    spin: boolean;
    title: string;
}

const PHASE_CONFIG: Record<Exclude<ComputeStatus, "idle">, PhaseConfig> = {
    submitting: {
        icon: "sync",
        iconColorClass: "text-gray-500",
        spin: true,
        title: "Submitting Request...",
    },
    polling: {
        icon: "sync",
        iconColorClass: "text-teal-600",
        spin: true,
        title: "Computing...",
    },
    completed: {
        icon: "check_circle",
        iconColorClass: "text-teal-600",
        spin: false,
        title: "Computation Complete",
    },
    failed: {
        icon: "error",
        iconColorClass: "text-red-500",
        spin: false,
        title: "Computation Failed",
    },
};

export default function ComputeExecuteModal() {
    const { isModalOpen, status, error, closeModal } = useComputeResultStore();
    const closeTimerRef = useRef<number | null>(null);

    const completedAtRef = useRef<number | null>(null);

    useEffect(() => {
        if (status !== "completed") return;

        completedAtRef.current = Date.now();

        closeTimerRef.current = window.setTimeout(() => {
            closeModal();
        }, MIN_OPEN_MS);

        return () => {
            if (closeTimerRef.current != null) {
                window.clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }
        };
    }, [status, closeModal]);

    if (!isModalOpen || status === "idle") return null;

    const phase = PHASE_CONFIG[status];
    const isFailed = status === "failed";

    function handleBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
        if (isFailed && e.target === e.currentTarget) {
            closeModal();
        }
    }

    return (
        <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 select-none"
            onMouseDown={handleBackdropMouseDown}
        >
            <div className="flex flex-col w-100 bg-gray-100 rounded-lg shadow-xl overflow-hidden">

                {/* Header — icon + title */}
                <div className="flex items-center gap-4 px-5 py-4">
                    <span
                        className={`material-symbols-outlined ${phase.iconColorClass} ${phase.spin ? "animate-spin [animation-direction:reverse]" : ""}`}
                        style={{ fontSize: 24 }}
                    >
                        {phase.icon}
                    </span>
                    <span className="text-sm font-semibold text-gray-700 tracking-wide">
                        {phase.title}
                    </span>
                </div>

                {/* Error detail */}
                {isFailed && error && (
                    <p className="px-5 pb-4 text-sm text-gray-500">
                        {error}
                    </p>
                )}

                {/* Footer — only shown on failure */}
                {isFailed && (
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200">
                        <ModalFooterButton onClick={closeModal}>
                            Close
                        </ModalFooterButton>
                    </div>
                )}
            </div>
        </div>
    );
}
