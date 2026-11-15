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
        ? "text-faint"
        : active
            ? "border-2 text-accent hover:bg-hover active:bg-pressed"
            : danger
                ? "text-faint hover:bg-danger-soft hover:text-danger"
                : "text-faint hover:bg-hover hover:text-fg";

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