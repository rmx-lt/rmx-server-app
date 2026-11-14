import { useEffect, type RefObject } from "react";

interface UseInternalCardModalListPartSelectionDismissOptions {
    enabled: boolean;
    rootRef: RefObject<HTMLElement | null>;
    onClearSelection?: () => void;
}

export default function useInternalCardModalListPartSelectionDismiss({
    enabled,
    rootRef,
    onClearSelection,
}: UseInternalCardModalListPartSelectionDismissOptions) {
    useEffect(() => {
        if (!enabled || !onClearSelection) {
            return;
        }

        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (target.closest("[data-list-part-keep-selection='true']")) {
                return;
            }

            const root = rootRef.current;
            if (root?.contains(target)) {
                onClearSelection();
                return;
            }

            onClearSelection();
        };

        document.addEventListener("mousedown", handleMouseDown);
        return () => document.removeEventListener("mousedown", handleMouseDown);
    }, [enabled, onClearSelection, rootRef]);
}
