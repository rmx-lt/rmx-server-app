import { type ReactNode } from "react";
import ModalActionBar, { type ModalActionBarItem } from "@/components/modal/modal-action-bar/ModalActionBar";
import ModalTitle from "@/components/modal/modal-title/ModalTitle";
import InternalCardModalHeader, { type InternalCardModalSavedState } from "./internal/InternalCardModalHeader";
import InternalCardModalFastTab from "./internal/InternalCardModalFastTab";
import CardModalField, { type CardModalFieldConfig } from "./CardModalField";
import InternalCardModalListPart from "./internal/InternalCardModalListPart";
import type {
    CardModalListPartConfig,
} from "./CardModalListPart.types";
import { useModalLifecycle } from "../../../hooks/modals/useModalLifecycle";

export type CardModalSavedState = InternalCardModalSavedState;
export type {
    CardModalListPartBaseRow,
    CardModalListPartCell,
    CardModalListPartCellEditor,
    CardModalListPartColumn,
    CardModalListPartConfig,
    CardModalListPartGroupRow,
    CardModalListPartNewResult,
    CardModalListPartRecordAction,
    CardModalListPartRecordRow,
    CardModalListPartRow,
    CardModalListPartRowId,
    CardModalListPartTableAction,
    CardModalListPartTableActionContext,
    CardModalListPartTableActions,
} from "./CardModalListPart.types";

export interface CardModalHeaderConfig {
    recordId: number | null;
    recordName: string;
    savedState: CardModalSavedState;
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

export type { CardModalFieldConfig } from "./CardModalField";
export { default as CardModalField } from "./CardModalField";

export interface CardModalFastTabConfig {
    id: string;
    title: string;
    expanded: boolean;
    onToggle: () => void;
    disabled?: boolean;
    fields?: CardModalFieldConfig[];
    listPart?: CardModalListPartConfig;
    content?: ReactNode;
}

function CardModalRenderedListPart({
    listPart,
}: {
    listPart: CardModalListPartConfig;
}) {
    const {
        content,
        ...listPartProps
    } = listPart;

    return (
        <InternalCardModalListPart {...listPartProps}>
            {content}
        </InternalCardModalListPart>
    );
}

export interface CardModalProps {
    isOpen: boolean;
    title: string;
    shortcutToken: string;
    onClose: () => void;
    header?: CardModalHeaderConfig;
    actionBarActions?: ModalActionBarItem[];
    fastTabs?: CardModalFastTabConfig[];
    children?: ReactNode;
    widthClassName?: string;
    bodyClassName?: string;
    canCloseOnEscape?: boolean;
}

export default function CardModal({
    isOpen,
    title,
    shortcutToken,
    onClose,
    header,
    actionBarActions = [],
    fastTabs = [],
    children,
    widthClassName = "w-240",
    bodyClassName = "flex flex-col flex-1 min-h-0 overflow-y-auto p-4 gap-3",
    canCloseOnEscape = true,
}: CardModalProps) {
    const { handleBackdropMouseDown } = useModalLifecycle({
        isOpen,
        shortcutToken,
        onClose,
        canCloseOnEscape,
    });

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 select-none"
            onMouseDown={handleBackdropMouseDown}
        >
            <div className={`flex flex-col ${widthClassName} max-h-[90vh] min-h-0 bg-gray-100 rounded-lg shadow-xl overflow-hidden`}>
                <ModalTitle title={title} onClose={onClose} />
                {header ? <InternalCardModalHeader {...header} /> : null}
                <ModalActionBar actions={actionBarActions} />
                <div className={bodyClassName}>
                    {fastTabs.map((fastTab) => (
                        <InternalCardModalFastTab
                            key={fastTab.id}
                            title={fastTab.title}
                            expanded={fastTab.expanded}
                            onToggle={fastTab.onToggle}
                            disabled={fastTab.disabled}
                        >
                            {fastTab.fields?.map((field) => (
                                <CardModalField key={field.id} {...field} />
                            ))}
                            {fastTab.listPart ? <CardModalRenderedListPart listPart={fastTab.listPart} /> : null}
                            {fastTab.content}
                        </InternalCardModalFastTab>
                    ))}
                    {children}
                </div>
            </div>
        </div>
    );
}
