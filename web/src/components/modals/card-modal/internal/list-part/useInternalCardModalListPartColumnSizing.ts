import { useCallback, useEffect, useRef, useState } from "react";
import type { CardModalListPartColumn } from "@/components/modals/card-modal/CardModalListPart.types";

const DEFAULT_COLUMN_WIDTH = 180;
const DEFAULT_MIN_WIDTH = 120;

function clampColumnWidth(width: number, minWidth: number) {
    return Math.max(minWidth, Math.round(width));
}

function buildDefaultWidths(columns: CardModalListPartColumn[]) {
    return Object.fromEntries(
        columns.map((column) => {
            const minWidth = column.minWidth ?? DEFAULT_MIN_WIDTH;
            const width = clampColumnWidth(column.width ?? DEFAULT_COLUMN_WIDTH, minWidth);

            return [column.id, width];
        }),
    ) as Record<string, number>;
}

function readStoredWidths(storageKey: string | undefined) {
    if (!storageKey || typeof window === "undefined") {
        return {} as Record<string, number>;
    }

    try {
        const rawValue = window.sessionStorage.getItem(storageKey);

        if (!rawValue) {
            return {} as Record<string, number>;
        }

        const parsedValue = JSON.parse(rawValue) as Record<string, number>;
        return typeof parsedValue === "object" && parsedValue !== null ? parsedValue : {};
    } catch {
        return {} as Record<string, number>;
    }
}

function buildResolvedWidths(columns: CardModalListPartColumn[], overrides: Record<string, number>) {
    const defaults = buildDefaultWidths(columns);

    for (const column of columns) {
        const minWidth = column.minWidth ?? DEFAULT_MIN_WIDTH;
        const nextWidth = overrides[column.id];

        if (typeof nextWidth === "number" && Number.isFinite(nextWidth)) {
            defaults[column.id] = clampColumnWidth(nextWidth, minWidth);
        }
    }

    return defaults;
}

interface UseInternalCardModalListPartColumnSizingOptions {
    storageKey?: string;
    columns: CardModalListPartColumn[];
}

export default function useInternalCardModalListPartColumnSizing({
    storageKey,
    columns,
}: UseInternalCardModalListPartColumnSizingOptions) {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => (
        buildResolvedWidths(columns, readStoredWidths(storageKey))
    ));
    const [resizingColumnId, setResizingColumnId] = useState<string | null>(null);
    const dragCleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        setColumnWidths((currentWidths) => buildResolvedWidths(columns, currentWidths));
    }, [columns]);

    useEffect(() => {
        if (!storageKey || typeof window === "undefined") {
            return;
        }

        window.sessionStorage.setItem(storageKey, JSON.stringify(columnWidths));
    }, [columnWidths, storageKey]);

    useEffect(() => () => {
        dragCleanupRef.current?.();
    }, []);

    const handleResizeStart = useCallback((event: React.MouseEvent, columnId: string) => {
        event.preventDefault();
        event.stopPropagation();

        const column = columns.find((candidate) => candidate.id === columnId);
        if (!column) {
            return;
        }

        const startX = event.clientX;
        const startWidth = columnWidths[columnId] ?? column.width ?? DEFAULT_COLUMN_WIDTH;
        const minWidth = column.minWidth ?? DEFAULT_MIN_WIDTH;

        setResizingColumnId(columnId);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const nextWidth = clampColumnWidth(startWidth + deltaX, minWidth);

            setColumnWidths((currentWidths) => {
                if (currentWidths[columnId] === nextWidth) {
                    return currentWidths;
                }

                return {
                    ...currentWidths,
                    [columnId]: nextWidth,
                };
            });
        };

        const handleMouseUp = () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            setResizingColumnId(null);
            dragCleanupRef.current = null;
        };

        dragCleanupRef.current?.();
        dragCleanupRef.current = handleMouseUp;

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    }, [columnWidths, columns]);

    return {
        columnWidths,
        resizingColumnId,
        handleResizeStart,
    };
}
