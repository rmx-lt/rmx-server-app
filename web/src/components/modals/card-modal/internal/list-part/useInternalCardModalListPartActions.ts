import { useCallback, useState } from "react";
import type { CardModalListPartRowId } from "@/components/modals/card-modal/CardModalListPart.types";

interface UseInternalCardModalListPartActionsOptions {
    onReplaceSelection?: (rowId: CardModalListPartRowId) => void;
}

export default function useInternalCardModalListPartActions({
    onReplaceSelection,
}: UseInternalCardModalListPartActionsOptions) {
    const [openMenuRowId, setOpenMenuRowId] = useState<CardModalListPartRowId | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

    const closeMenu = useCallback(() => {
        setOpenMenuRowId(null);
        setMenuPos(null);
    }, []);

    const handleMoreClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, rowId: CardModalListPartRowId) => {
        event.stopPropagation();
        onReplaceSelection?.(rowId);

        const rect = event.currentTarget.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 2, left: rect.left });
        setOpenMenuRowId(rowId);
    }, [onReplaceSelection]);

    return {
        openMenuRowId,
        menuPos,
        closeMenu,
        handleMoreClick,
    };
}
