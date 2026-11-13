import InternalCardModalHeaderActions from "./InternalCardModalHeaderActions";

export type InternalCardModalSavedState = "saved" | "unsaved" | "saving" | "nothing_to_save";

interface InternalCardModalHeaderProps {
    recordId: number | null;
    recordName: string;
    savedState: InternalCardModalSavedState;
    onSave: () => void;
    canSave?: boolean;
    isEditMode: boolean;
    onEdit: () => void;
    onNew: () => void;
    onDelete: () => void;
    canEdit?: boolean;
    canNew?: boolean;
    canDelete?: boolean;
}

function SavedStateButton({
    savedState,
    onSave,
    canSave = true,
}: {
    savedState: InternalCardModalSavedState;
    onSave: () => void;
    canSave?: boolean;
}) {
    if (savedState === "nothing_to_save") return null;

    const isUnsaved = savedState === "unsaved";
    const isSaving = savedState === "saving";
    const isSaveEnabled = isUnsaved && canSave;

    return (
        <button
            type="button"
            onClick={isSaveEnabled ? onSave : undefined}
            disabled={!isSaveEnabled}
            title={
                savedState === "saved"
                    ? "All changes saved"
                    : isSaving
                        ? "Autosave pending"
                        : canSave
                            ? "Save changes"
                            : "Fill required fields to save"
            }
            className={[
                "flex items-center gap-1 px-2 py-0.5 rounded text-sm transition-colors",
                isSaveEnabled
                    ? "text-amber-600 hover:bg-amber-50 cursor-pointer"
                    : isSaving
                        ? "text-gray-500 animate-pulse cursor-default"
                        : isUnsaved
                            ? "text-amber-500 opacity-70 cursor-not-allowed"
                            : "text-gray-500 cursor-default",
            ].join(" ")}
        >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                {isUnsaved ? "save" : isSaving ? "schedule" : "check_circle"}
            </span>
            {isUnsaved ? "Unsaved" : isSaving ? "Saving..." : "Saved"}
        </button>
    );
}

export default function InternalCardModalHeader({
    recordId,
    recordName,
    savedState,
    onSave,
    canSave = true,
    isEditMode,
    onEdit,
    onNew,
    onDelete,
    canEdit = true,
    canNew = true,
    canDelete = true,
}: InternalCardModalHeaderProps) {
    return (
        <div className="flex items-center px-5 pb-1 bg-gray-100 select-none shrink-0">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {recordId !== null && (
                    <>
                        <span className="text-lg text-gray-700 shrink-0">{recordId}</span>
                        <span className="text-lg font-bold text-gray-400">·</span>
                    </>
                )}
                <span className="text-lg text-gray-700 truncate" title={recordName || undefined}>
                    {recordName || <span className="text-gray-400 italic">New record</span>}
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

            <div className="flex items-center justify-end flex-1">
                <SavedStateButton savedState={savedState} onSave={onSave} canSave={canSave} />
            </div>
        </div>
    );
}