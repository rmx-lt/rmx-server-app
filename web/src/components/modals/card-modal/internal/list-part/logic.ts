import type {
    CardModalListPartColumn,
    CardModalListPartNewResult,
    CardModalListPartRecordAction,
    CardModalListPartRow,
    CardModalListPartRowId,
} from "@/components/modals/card-modal/CardModalListPart.types";
import {
    ACTIONS_COLUMN_WIDTH,
    SELECTION_COLUMN_WIDTH,
} from "./presentation";

export function getRecordActionsForRow(
    rows: CardModalListPartRow[],
    targetRowId: CardModalListPartRowId | null,
): CardModalListPartRecordAction[] {
    if (targetRowId === null) {
        return [];
    }

    for (const row of rows) {
        if (row.id === targetRowId && row.kind === "record") {
            return row.actions ?? [];
        }

        if (row.kind === "group") {
            const nestedActions = getRecordActionsForRow(row.children, targetRowId);
            if (nestedActions.length > 0) {
                return nestedActions;
            }
        }
    }

    return [];
}

export function getGridTemplateColumns(
    mainColumn: CardModalListPartColumn,
    dataColumns: CardModalListPartColumn[],
    columnWidths: Record<string, number>,
) {
    const domainColumns = dataColumns.map((column) => `${columnWidths[column.id] ?? column.width ?? 180}px`);
    const mainColumnWidth = columnWidths[mainColumn.id] ?? mainColumn.width ?? 180;

    return [
        `${SELECTION_COLUMN_WIDTH}px`,
        `minmax(${mainColumnWidth}px, 1fr)`,
        `${ACTIONS_COLUMN_WIDTH}px`,
        ...domainColumns,
    ].join(" ");
}

export function getTotalGridWidth(
    mainColumn: CardModalListPartColumn,
    dataColumns: CardModalListPartColumn[],
    columnWidths: Record<string, number>,
) {
    return SELECTION_COLUMN_WIDTH
        + (columnWidths[mainColumn.id] ?? mainColumn.width ?? 180)
        + ACTIONS_COLUMN_WIDTH
        + dataColumns.reduce((totalWidth, column) => totalWidth + (columnWidths[column.id] ?? column.width ?? 180), 0);
}

export function getNextSelectedRowIds(
    rowId: CardModalListPartRowId,
    selectedRowIds: CardModalListPartRowId[],
    selectedRowIdSet: ReadonlySet<CardModalListPartRowId>,
    isMultiSelect: boolean,
) {
    if (!isMultiSelect) {
        return [rowId];
    }

    if (selectedRowIdSet.has(rowId)) {
        return selectedRowIds.filter((selectedRowId) => selectedRowId !== rowId);
    }

    return [...selectedRowIds, rowId];
}

export function getNextEditingColumnId(
    columns: CardModalListPartColumn[],
    result: CardModalListPartNewResult,
) {
    const fallbackColumnId = columns.find((column) => column.editable !== false)?.id;
    return result.columnId ?? fallbackColumnId;
}
