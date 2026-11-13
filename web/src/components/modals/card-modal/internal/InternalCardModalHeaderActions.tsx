interface InternalCardModalHeaderActionsProps {
    isEditMode: boolean;
    onEdit: () => void;
    onNew: () => void;
    onDelete: () => void;
    canEdit?: boolean;
    canNew?: boolean;
    canDelete?: boolean;
}

function ActionButton({
    icon,
    title,
    onClick,
    active = false,
    danger = false,
    disabled = false,
}: {
    icon: string;
    title: string;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
}) {
    const base = "flex items-center justify-center w-8 h-8 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
    const style = disabled
        ? "text-gray-300"
        : active
            ? "border-2 text-teal-700 hover:bg-gray-200 active:bg-gray-300"
            : danger
                ? "text-gray-400 hover:bg-red-50 hover:text-red-600"
                : "text-gray-400 hover:bg-gray-200 hover:text-gray-700";

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`${base} ${style}`}
        >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{icon}</span>
        </button>
    );
}

export default function InternalCardModalHeaderActions({
    isEditMode,
    onEdit,
    onNew,
    onDelete,
    canEdit = true,
    canNew = true,
    canDelete = true,
}: InternalCardModalHeaderActionsProps) {
    return (
        <div className="flex items-center gap-0.5">
            <ActionButton
                icon="edit"
                title={isEditMode ? "Exit edit mode" : "Edit"}
                onClick={onEdit}
                active={isEditMode}
                disabled={!canEdit}
            />
            <ActionButton icon="add" title="New" onClick={onNew} disabled={!canNew} />
            <ActionButton
                icon="delete"
                title="Delete"
                onClick={onDelete}
                danger
                disabled={!canDelete}
            />
        </div>
    );
}