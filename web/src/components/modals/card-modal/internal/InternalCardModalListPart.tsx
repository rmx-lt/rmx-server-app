import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type {
    CardModalListPartColumn,
    CardModalListPartRow,
    CardModalListPartRowId,
    CardModalListPartTableActions,
} from "@/components/modals/card-modal/CardModalListPart.types";
import { flattenInternalCardModalListPartRows } from "./list-part/flattenRows";
import {
    InternalCardModalListPartRecordActionsMenu,
    InternalCardModalListPartToolbar,
} from "./list-part/InternalCardModalListPartActions";
import InternalCardModalListPartHeader from "./list-part/InternalCardModalListPartHeader";
import {
    type InternalCardModalListPartEditingCell,
    InternalCardModalListPartGroupRow,
    InternalCardModalListPartRecordRow,
} from "./list-part/InternalCardModalListPartRows";
import {
    getGridTemplateColumns,
    getNextEditingColumnId,
    getNextSelectedRowIds,
    getRecordActionsForRow,
    getTotalGridWidth,
} from "./list-part/logic";
import useInternalCardModalListPartActions from "./list-part/useInternalCardModalListPartActions";
import useInternalCardModalListPartColumnSizing from "./list-part/useInternalCardModalListPartColumnSizing";
import useInternalCardModalListPartSelectionDismiss from "./list-part/useInternalCardModalListPartSelectionDismiss";

const FALLBACK_MAIN_COLUMN: CardModalListPartColumn = {
    id: "__main-column__",
    title: "",
    width: 180,
    editable: false,
};

export interface InternalCardModalListPartProps {
    title?: ReactNode;
    badge?: ReactNode;
    columns?: CardModalListPartColumn[];
    rows?: CardModalListPartRow[];
    emptyMessage?: ReactNode;
    maxHeightClassName?: string;
    editable?: boolean;
    storageKey?: string;
    selectedRowIds?: CardModalListPartRowId[];
    onSelectedRowIdsChange?: (nextSelectedRowIds: CardModalListPartRowId[]) => void;
    tableActions?: CardModalListPartTableActions;
    children?: ReactNode;
}

export default function InternalCardModalListPart({
    title,
    badge,
    columns = [],
    rows,
    emptyMessage,
    maxHeightClassName,
    editable = false,
    storageKey,
    selectedRowIds = [],
    onSelectedRowIdsChange,
    tableActions,
    children,
}: InternalCardModalListPartProps) {
    const hasListContent = rows !== undefined;
    const hasHeader = title !== undefined || badge !== undefined;
    const hasRows = (rows?.length ?? 0) > 0;
    const mainColumn = columns[0] ?? FALLBACK_MAIN_COLUMN;
    const dataColumns = useMemo(
        () => columns.slice(1),
        [columns],
    );
    const selectedRowIdSet = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);
    const flattenedRows = useMemo(() => (
        rows ? flattenInternalCardModalListPartRows(rows) : []
    ), [rows]);
    const { columnWidths, resizingColumnId, handleResizeStart } = useInternalCardModalListPartColumnSizing({
        storageKey,
        columns,
    });
    const { openMenuRowId, menuPos, closeMenu, handleMoreClick } = useInternalCardModalListPartActions({
        onReplaceSelection: (rowId) => onSelectedRowIdsChange?.([rowId]),
    });
    const rootRef = useRef<HTMLDivElement>(null);
    const [editingCell, setEditingCell] = useState<InternalCardModalListPartEditingCell | null>(null);

    useInternalCardModalListPartSelectionDismiss({
        enabled: selectedRowIds.length > 0,
        rootRef,
        onClearSelection: () => onSelectedRowIdsChange?.([]),
    });

    useEffect(() => {
        if (!editable) {
            setEditingCell(null);
        }
    }, [editable]);

    const recordActions = useMemo(
        () => getRecordActionsForRow(rows ?? [], openMenuRowId),
        [openMenuRowId, rows],
    );

    const gridTemplateColumns = useMemo(
        () => getGridTemplateColumns(mainColumn, dataColumns, columnWidths),
        [columnWidths, dataColumns, mainColumn],
    );

    const totalGridWidth = useMemo(
        () => getTotalGridWidth(mainColumn, dataColumns, columnWidths),
        [columnWidths, dataColumns, mainColumn],
    );

    const scrollClassName = ["overflow-auto", maxHeightClassName].filter(Boolean).join(" ");

    function handleRowSelection(event: MouseEvent<HTMLElement>, rowId: CardModalListPartRowId) {
        if (!onSelectedRowIdsChange) {
            return;
        }

        if (event.ctrlKey || event.metaKey) {
            onSelectedRowIdsChange(getNextSelectedRowIds(rowId, selectedRowIds, selectedRowIdSet, true));
            return;
        }

        onSelectedRowIdsChange(getNextSelectedRowIds(rowId, selectedRowIds, selectedRowIdSet, false));
    }

    async function handleBuiltInNew() {
        if (!tableActions?.onNew) {
            return;
        }

        const result = await tableActions.onNew();
        if (!result) {
            return;
        }

        onSelectedRowIdsChange?.([result.rowId]);

        const targetColumnId = getNextEditingColumnId(columns, result);

        if (targetColumnId) {
            setEditingCell({ rowId: result.rowId, columnId: targetColumnId });
        }
    }

    async function handleBuiltInDelete() {
        if (!tableActions?.onDelete || selectedRowIds.length === 0) {
            return;
        }

        await tableActions.onDelete(selectedRowIds);
        onSelectedRowIdsChange?.([]);
    }

    return (
        <div ref={rootRef} className="flex shrink-0 flex-col gap-2 min-h-0">
            {hasHeader ? (
                <div className="flex items-center gap-2 px-1">
                    {title ? <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</span> : null}
                    {badge}
                </div>
            ) : null}
            {hasListContent ? (
                <div className={`border rounded overflow-hidden ${editable ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50"}`}>
                    <InternalCardModalListPartToolbar
                        editable={editable}
                        selectedRowIds={selectedRowIds}
                        tableActions={tableActions}
                        onBuiltInNew={handleBuiltInNew}
                        onBuiltInDelete={handleBuiltInDelete}
                    />
                    {!hasRows ? (
                        emptyMessage ? (
                            <p className="text-sm text-gray-400 italic text-center py-6 px-4">{emptyMessage}</p>
                        ) : null
                    ) : (
                        <div className={scrollClassName}>
                            <div className="min-w-0" style={{ width: `max(100%, ${totalGridWidth}px)` }}>
                                <InternalCardModalListPartHeader
                                    gridTemplateColumns={gridTemplateColumns}
                                    mainColumn={mainColumn}
                                    dataColumns={dataColumns}
                                    resizingColumnId={resizingColumnId}
                                    onResizeStart={handleResizeStart}
                                />
                                <div className={editable ? "divide-y divide-gray-100" : undefined}>
                                    {flattenedRows.map(({ row, depth }) => {
                                        if (row.kind === "group") {
                                            return (
                                                <InternalCardModalListPartGroupRow
                                                    key={row.id}
                                                    row={row}
                                                    depth={depth}
                                                    gridTemplateColumns={gridTemplateColumns}
                                                    dataColumns={dataColumns}
                                                />
                                            );
                                        }

                                        return (
                                            <InternalCardModalListPartRecordRow
                                                key={row.id}
                                                row={row}
                                                depth={depth}
                                                editable={editable}
                                                gridTemplateColumns={gridTemplateColumns}
                                                mainColumn={mainColumn}
                                                dataColumns={dataColumns}
                                                editingCell={editingCell}
                                                openMenuRowId={openMenuRowId}
                                                selectedRowIds={selectedRowIds}
                                                selectedRowIdSet={selectedRowIdSet}
                                                onRowSelection={handleRowSelection}
                                                onMoreClick={handleMoreClick}
                                                onSetEditingCell={setEditingCell}
                                                onClearEditingCell={() => setEditingCell(null)}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                    <InternalCardModalListPartRecordActionsMenu
                        openMenuRowId={openMenuRowId}
                        menuPos={menuPos}
                        recordActions={recordActions}
                        closeMenu={closeMenu}
                    />
                </div>
            ) : children}
        </div>
    );
}
