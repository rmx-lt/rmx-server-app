import { createPortal } from "react-dom";
import type {
    CardModalListPartRecordAction,
    CardModalListPartRowId,
    CardModalListPartTableAction,
    CardModalListPartTableActions,
} from "@/components/modals/card-modal/CardModalListPart.types";

function InternalCardModalListPartTableActionButton({
    icon,
    label,
    onClick,
    disabled = false,
    variant = "default",
}: {
    icon: string;
    label: string;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    variant?: "default" | "danger";
}) {
    const colorClassName = variant === "danger"
        ? "border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
        : "border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400";

    return (
        <button
            type="button"
            onClick={() => {
                if (!disabled) {
                    void onClick();
                }
            }}
            disabled={disabled}
            className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${colorClassName}`}
        >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
            {label}
        </button>
    );
}

interface InternalCardModalListPartToolbarProps {
    editable: boolean;
    selectedRowIds: CardModalListPartRowId[];
    tableActions?: CardModalListPartTableActions;
    onBuiltInNew: () => void | Promise<void>;
    onBuiltInDelete: () => void | Promise<void>;
}

export function InternalCardModalListPartToolbar({
    editable,
    selectedRowIds,
    tableActions,
    onBuiltInNew,
    onBuiltInDelete,
}: InternalCardModalListPartToolbarProps) {
    const hasTableActions = Boolean(tableActions?.onNew)
        || Boolean(tableActions?.onDelete)
        || (tableActions?.actions?.length ?? 0) > 0;

    if (!hasTableActions) {
        return null;
    }

    return (
        <div data-list-part-keep-selection="true" className={`flex items-center gap-2 flex-wrap px-3 py-2 border-b ${editable ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-gray-100"}`}>
            {tableActions?.onNew ? (
                <InternalCardModalListPartTableActionButton
                    icon="add"
                    label="New"
                    onClick={onBuiltInNew}
                    disabled={tableActions.newDisabled || !editable}
                />
            ) : null}
            {tableActions?.onDelete ? (
                <InternalCardModalListPartTableActionButton
                    icon="delete"
                    label="Delete"
                    variant="danger"
                    onClick={onBuiltInDelete}
                    disabled={tableActions.deleteDisabled || !editable || selectedRowIds.length === 0}
                />
            ) : null}
            {tableActions?.actions?.map((action: CardModalListPartTableAction) => (
                <InternalCardModalListPartTableActionButton
                    key={action.id}
                    icon={action.icon}
                    label={action.label}
                    variant={action.variant}
                    disabled={action.disabled}
                    onClick={() => action.onClick({ selectedRowIds })}
                />
            ))}
        </div>
    );
}

interface InternalCardModalListPartRecordActionsMenuProps {
    openMenuRowId: CardModalListPartRowId | null;
    menuPos: { top: number; left: number } | null;
    recordActions: CardModalListPartRecordAction[];
    closeMenu: () => void;
}

export function InternalCardModalListPartRecordActionsMenu({
    openMenuRowId,
    menuPos,
    recordActions,
    closeMenu,
}: InternalCardModalListPartRecordActionsMenuProps) {
    if (openMenuRowId === null || !menuPos || recordActions.length === 0 || typeof document === "undefined") {
        return null;
    }

    return createPortal(
        <>
            <div
                className="fixed inset-0 z-55"
                onMouseDown={(event) => {
                    event.stopPropagation();
                    closeMenu();
                }}
            />
            <div
                data-list-part-keep-selection="true"
                style={{ top: menuPos.top, left: menuPos.left }}
                className="fixed z-58 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-36"
                onMouseDown={(event) => event.stopPropagation()}
            >
                {recordActions.map((action) => (
                    <button
                        key={action.id}
                        type="button"
                        disabled={action.disabled}
                        className={`flex items-center gap-2 w-full px-3 py-1 text-sm text-left cursor-pointer transition-colors hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed ${action.variant === "danger" ? "text-red-600" : "text-gray-700"}`}
                        onClick={() => {
                            void action.onClick(openMenuRowId);
                            closeMenu();
                        }}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{action.icon}</span>
                        {action.title}
                    </button>
                ))}
            </div>
        </>,
        document.body,
    );
}
