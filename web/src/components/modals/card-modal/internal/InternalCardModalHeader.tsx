import InternalCardModalHeaderActions from "./InternalCardModalHeaderActions";


interface InternalCardModalHeaderProps {
    recordId: number | null;
    recordName: string;
    isEditMode: boolean;
    onEdit: () => void;
    onNew: () => void;
    onDelete: () => void;
    canEdit?: boolean;
    canNew?: boolean;
    canDelete?: boolean;
}

export default function InternalCardModalHeader({
    recordId,
    recordName,
    isEditMode,
    onEdit,
    onNew,
    onDelete,
    canEdit = true,
    canNew = true,
    canDelete = true,
}: InternalCardModalHeaderProps) {
    return (
        <div className="flex items-center px-5 pb-1 bg-raised select-none shrink-0">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {recordId !== null && (
                    <>
                        <span className="text-lg text-fg shrink-0">{recordId}</span>
                        <span className="text-lg font-bold text-faint">·</span>
                    </>
                )}
                <span className="text-lg text-fg truncate" title={recordName || undefined}>
                    {recordName || <span className="text-faint italic">New record</span>}
                </span>
            </div>

            <div className="flex items-center justify-center flex-none px-4">
                <InternalCardModalHeaderActions
                    isEditMode={isEditMode}
                    onEdit={onEdit}
                    onNew={onNew}
                    onDelete={onDelete}
                    canEdit={canEdit}
                    canNew={canNew}
                    canDelete={canDelete}
                />
            </div>

            <div className="flex-1" />
        </div>
    );
}