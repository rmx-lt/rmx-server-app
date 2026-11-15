import { useCallback, useState, type MouseEvent } from "react";

interface UseInternalListModalInteractionsOptions {
    isOpen: boolean;
    selectedId?: number | null;
    onSelect?: (id: number) => void;
    onClearSelection?: () => void;
}

export default function useInternalListModalInteractions({
    isOpen,
    selectedId,
    onSelect,
    onClearSelection,
}: UseInternalListModalInteractionsOptions) {
    const [openMenuId, setOpenMenuId] = useState<number | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

    // Closing the modal closes its menu (adjusted during render, not in an effect).
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (!isOpen) {
            setOpenMenuId(null);
            setMenuPos(null);
        }
    }

    const closeMenu = useCallback(() => {
        setOpenMenuId(null);
    }, []);

    const handleMoreClick = useCallback((e: MouseEvent<HTMLButtonElement>, itemId: number) => {
        e.stopPropagation();
        if (itemId !== selectedId) onSelect?.(itemId);
        const rect = e.currentTarget.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 2, left: rect.left });
        setOpenMenuId(itemId);
    }, [selectedId, onSelect]);

    const handlePanelMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (!onClearSelection) return;

        const target = e.target as HTMLElement;
        const interactiveTarget = target.closest("button, input, textarea, select, [data-list-modal-keep-selection='true']");

        if (!interactiveTarget) {
            onClearSelection();
        }
    }, [onClearSelection]);

    return {
        openMenuId,
        menuPos,
        closeMenu,
        handleMoreClick,
        handlePanelMouseDown,
    };
}