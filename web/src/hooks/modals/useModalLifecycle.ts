import { useCallback, useEffect, type MouseEvent } from "react";
import { useShortcutsBlocked } from "@/hooks/shortcut-manager/useShortcutsBlocked";

interface UseModalLifecycleOptions {
    isOpen: boolean;
    shortcutToken: string;
    onClose: () => void;
    canCloseOnEscape?: boolean;
    canCloseOnBackdrop?: boolean;
}

export function useModalLifecycle({
    isOpen,
    shortcutToken,
    onClose,
    canCloseOnEscape = true,
    canCloseOnBackdrop = true,
}: UseModalLifecycleOptions) {
    useShortcutsBlocked(shortcutToken, isOpen);

    useEffect(() => {
        if (!isOpen || !canCloseOnEscape) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                onClose();
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose, canCloseOnEscape]);

    const handleBackdropMouseDown = useCallback((e: MouseEvent) => {
        if (!canCloseOnBackdrop) return;

        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [canCloseOnBackdrop, onClose]);

    return {
        handleBackdropMouseDown,
    };
}