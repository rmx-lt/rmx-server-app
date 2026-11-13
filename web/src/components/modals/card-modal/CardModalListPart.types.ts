import type { ReactNode } from "react";

export type CardModalListPartRowId = string | number;

export interface CardModalListPartColumn {
    id: string;
    title: ReactNode;
    width?: number;
    minWidth?: number;
    editable?: boolean;
}

export interface CardModalListPartCellEditor {
    type?: "text" | "number" | "password";
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    onConfirm?: () => void;
    onCancel?: () => void;
    disabled?: boolean;
}

export interface CardModalListPartCell {
    value: ReactNode;
    title?: string;
    tone?: "default" | "muted" | "subtle";
    mono?: boolean;
    editable?: boolean;
    editor?: CardModalListPartCellEditor;
    emptyValue?: ReactNode;
}

export interface CardModalListPartRecordAction {
    id: string;
    icon: string;
    title: string;
    onClick: (rowId: CardModalListPartRowId) => void | Promise<void>;
    variant?: "default" | "danger";
    disabled?: boolean;
}

export interface CardModalListPartBaseRow {
    id: CardModalListPartRowId;
    recordId?: ReactNode;
    selectable?: boolean;
}

export interface CardModalListPartGroupRow extends CardModalListPartBaseRow {
    kind: "group";
    label: ReactNode;
    expanded: boolean;
    onToggle: () => void;
    children: CardModalListPartRow[];
    cells?: Record<string, CardModalListPartCell | undefined>;
}

export interface CardModalListPartRecordRow extends CardModalListPartBaseRow {
    kind: "record";
    cells: Record<string, CardModalListPartCell | undefined>;
    actions?: CardModalListPartRecordAction[];
}

export type CardModalListPartRow =
    | CardModalListPartGroupRow
    | CardModalListPartRecordRow;

export interface CardModalListPartNewResult {
    rowId: CardModalListPartRowId;
    columnId?: string;
}

export interface CardModalListPartTableActionContext {
    selectedRowIds: CardModalListPartRowId[];
}

export interface CardModalListPartTableAction {
    id: string;
    icon: string;
    label: string;
    onClick: (context: CardModalListPartTableActionContext) => void | Promise<void>;
    variant?: "default" | "danger";
    disabled?: boolean;
}

export interface CardModalListPartTableActions {
    onNew?: () => void | CardModalListPartNewResult | Promise<void | CardModalListPartNewResult>;
    newDisabled?: boolean;
    onDelete?: (selectedRowIds: CardModalListPartRowId[]) => void | Promise<void>;
    deleteDisabled?: boolean;
    actions?: CardModalListPartTableAction[];
}

export interface CardModalListPartConfig {
    title?: ReactNode;
    badge?: ReactNode;
    content?: ReactNode;
    columns?: CardModalListPartColumn[];
    rows?: CardModalListPartRow[];
    emptyMessage?: ReactNode;
    maxHeightClassName?: string;
    editable?: boolean;
    storageKey?: string;
    selectedRowIds?: CardModalListPartRowId[];
    onSelectedRowIdsChange?: (nextSelectedRowIds: CardModalListPartRowId[]) => void;
    tableActions?: CardModalListPartTableActions;
}
