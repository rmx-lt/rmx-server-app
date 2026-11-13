import type { MouseEvent } from "react";
import type {
    CardModalListPartCell,
    CardModalListPartColumn,
    CardModalListPartGroupRow,
    CardModalListPartRecordRow,
    CardModalListPartRowId,
} from "@/components/modals/card-modal/CardModalListPart.types";
import { getToneClassName, ROW_INDENT_STEP } from "./presentation";

export interface InternalCardModalListPartEditingCell {
    rowId: CardModalListPartRowId;
    columnId: string;
}

function isEditableCell(
    editable: boolean,
    column: CardModalListPartColumn,
    cell?: CardModalListPartCell,
) {
    return editable
        && column.editable !== false
        && cell?.editable !== false
        && Boolean(cell?.editor)
        && !cell?.editor?.disabled;
}

function InternalCardModalListPartCell({
    cell,
    editable,
    isEditing,
    isCellEditable,
    wrapperClassName,
    contentClassName,
    indentPx,
    onStartEditing,
    onStopEditing,
}: {
    cell?: CardModalListPartCell;
    editable: boolean;
    isEditing: boolean;
    isCellEditable: boolean;
    wrapperClassName: string;
    contentClassName: string;
    indentPx?: number;
    onStartEditing?: () => void;
    onStopEditing: () => void;
}) {
    const displayValue = cell?.value ?? cell?.emptyValue ?? <span className="text-gray-300">—</span>;
    const toneClassName = getToneClassName(cell?.tone);
    const monoClassName = cell?.mono ? "font-mono" : "";

    return (
        <div
            className={wrapperClassName}
            onDoubleClick={(event) => {
                event.stopPropagation();

                if (isCellEditable) {
                    onStartEditing?.();
                }
            }}
        >
            <div className={contentClassName} style={indentPx !== undefined ? { paddingLeft: indentPx } : undefined}>
                {isEditing && cell?.editor ? (
                    <input
                        autoFocus
                        type={cell.editor.type ?? "text"}
                        value={cell.editor.value}
                        placeholder={cell.editor.placeholder}
                        disabled={!editable || cell.editor.disabled}
                        onChange={(event) => cell.editor?.onChange(event.target.value)}
                        onBlur={() => {
                            cell.editor?.onConfirm?.();
                            onStopEditing();
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                cell.editor?.onConfirm?.();
                                onStopEditing();
                            }

                            if (event.key === "Escape") {
                                cell.editor?.onCancel?.();
                                onStopEditing();
                            }
                        }}
                        className="w-full px-2 py-1 text-sm border border-teal-600 rounded bg-white text-gray-800 focus:outline-none"
                    />
                ) : (
                    <span className={`truncate ${toneClassName} ${monoClassName}`.trim()} title={cell?.title}>
                        {displayValue}
                    </span>
                )}
            </div>
        </div>
    );
}

interface InternalCardModalListPartGroupRowProps {
    row: CardModalListPartGroupRow;
    depth: number;
    gridTemplateColumns: string;
    dataColumns: CardModalListPartColumn[];
}

export function InternalCardModalListPartGroupRow({
    row,
    depth,
    gridTemplateColumns,
    dataColumns,
}: InternalCardModalListPartGroupRowProps) {
    return (
        <div className="grid w-full items-stretch bg-gray-50" style={{ gridTemplateColumns }}>
            <button
                type="button"
                onClick={row.onToggle}
                className="flex items-center justify-center border-r border-gray-200 text-gray-400 hover:text-gray-600 cursor-pointer"
                title={row.expanded ? "Collapse group" : "Expand group"}
            >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    {row.expanded ? "expand_more" : "chevron_right"}
                </span>
            </button>
            <div className="flex min-w-0 items-center px-3 py-2 border-r border-gray-200 text-sm font-semibold text-gray-700">
                <span className="truncate" style={{ paddingLeft: depth * ROW_INDENT_STEP }} title={typeof row.label === "string" ? row.label : undefined}>
                    {row.label}
                </span>
            </div>
            <div className="border-r border-gray-200" />
            {dataColumns.map((column) => (
                <InternalCardModalListPartCell
                    key={`${row.id}-${column.id}`}
                    cell={row.cells?.[column.id]}
                    editable={false}
                    isEditing={false}
                    isCellEditable={false}
                    wrapperClassName="flex min-w-0 items-center px-3 py-2 border-r last:border-r-0 border-gray-200 text-sm text-gray-500"
                    contentClassName="flex min-w-0 w-full items-center"
                    onStopEditing={() => undefined}
                />
            ))}
        </div>
    );
}

interface InternalCardModalListPartRecordRowProps {
    row: CardModalListPartRecordRow;
    depth: number;
    editable: boolean;
    gridTemplateColumns: string;
    mainColumn: CardModalListPartColumn;
    dataColumns: CardModalListPartColumn[];
    editingCell: InternalCardModalListPartEditingCell | null;
    openMenuRowId: CardModalListPartRowId | null;
    selectedRowIds: CardModalListPartRowId[];
    selectedRowIdSet: ReadonlySet<CardModalListPartRowId>;
    onRowSelection: (event: MouseEvent<HTMLElement>, rowId: CardModalListPartRowId) => void;
    onMoreClick: (event: MouseEvent<HTMLButtonElement>, rowId: CardModalListPartRowId) => void;
    onSetEditingCell: (nextEditingCell: InternalCardModalListPartEditingCell) => void;
    onClearEditingCell: () => void;
}

export function InternalCardModalListPartRecordRow({
    row,
    depth,
    editable,
    gridTemplateColumns,
    mainColumn,
    dataColumns,
    editingCell,
    openMenuRowId,
    selectedRowIds,
    selectedRowIdSet,
    onRowSelection,
    onMoreClick,
    onSetEditingCell,
    onClearEditingCell,
}: InternalCardModalListPartRecordRowProps) {
    const isSelected = selectedRowIdSet.has(row.id);
    const selectedIndicatorIcon = selectedRowIds.length > 1 ? "check_circle" : "arrow_forward";
    const hoverIndicatorIcon = selectedRowIds.length > 1 ? "circle" : "arrow_forward";
    const rowTextClassName = editable ? "text-gray-700" : "text-gray-500";
    const rowBackgroundClassName = editable
        ? "bg-white hover:bg-gray-50"
        : "bg-gray-50 hover:bg-gray-100";
    const mainColumnCell = row.cells[mainColumn.id];
    const isMainColumnEditing = editingCell?.rowId === row.id && editingCell.columnId === mainColumn.id;
    const isMainColumnEditable = isEditableCell(editable, mainColumn, mainColumnCell);

    return (
        <div
            data-list-part-keep-selection="true"
            className={`group grid w-full items-stretch transition-colors ${rowBackgroundClassName}`}
            style={{ gridTemplateColumns }}
            onClick={(event) => {
                if (row.selectable === false) {
                    return;
                }

                onRowSelection(event, row.id);
            }}
        >
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    if (row.selectable === false) {
                        return;
                    }

                    onRowSelection(event, row.id);
                }}
                className={`flex items-center justify-center border-r border-gray-200 cursor-pointer ${isSelected ? "text-teal-600" : "text-gray-300"}`}
                title={isSelected ? "Deselect row" : "Select row"}
            >
                {isSelected ? (
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        {selectedIndicatorIcon}
                    </span>
                ) : (
                    <span className="material-symbols-outlined opacity-0 transition-opacity group-hover:opacity-100" style={{ fontSize: 18 }}>
                        {hoverIndicatorIcon}
                    </span>
                )}
            </button>
            <InternalCardModalListPartCell
                cell={mainColumnCell}
                editable={editable}
                isEditing={isMainColumnEditing}
                isCellEditable={isMainColumnEditable}
                wrapperClassName={`flex min-w-0 items-center px-3 py-2 border-r border-gray-200 text-sm ${rowTextClassName}`}
                contentClassName="flex min-w-0 w-full items-center"
                indentPx={depth * ROW_INDENT_STEP}
                onStartEditing={() => onSetEditingCell({ rowId: row.id, columnId: mainColumn.id })}
                onStopEditing={onClearEditingCell}
            />
            <div className="flex items-center justify-center border-r border-gray-200">
                {row.actions && row.actions.length > 0 ? (
                    <button
                        type="button"
                        onClick={(event) => onMoreClick(event, row.id)}
                        className={`flex items-center justify-center w-7 h-7 rounded transition-opacity cursor-pointer ${isSelected ? "opacity-100 text-teal-600 hover:text-teal-700 hover:bg-gray-100" : openMenuRowId === row.id ? "opacity-100 text-gray-600 bg-gray-100" : "opacity-0 text-gray-400 hover:text-gray-700 hover:bg-gray-100 group-hover:opacity-100"}`}
                        title="Record actions"
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>more_vert</span>
                    </button>
                ) : null}
            </div>
            {dataColumns.map((column) => {
                const cell = row.cells[column.id];
                const isEditing = editingCell?.rowId === row.id && editingCell.columnId === column.id;
                const isCellEditable = isEditableCell(editable, column, cell);

                return (
                    <InternalCardModalListPartCell
                        key={`${row.id}-${column.id}`}
                        cell={cell}
                        editable={editable}
                        isEditing={isEditing}
                        isCellEditable={isCellEditable}
                        wrapperClassName={`flex min-w-0 items-center px-3 py-2 border-r last:border-r-0 border-gray-200 text-sm justify-start text-left ${rowTextClassName}`}
                        contentClassName="flex min-w-0 w-full items-center"
                        onStartEditing={() => onSetEditingCell({ rowId: row.id, columnId: column.id })}
                        onStopEditing={onClearEditingCell}
                    />
                );
            })}
        </div>
    );
}
