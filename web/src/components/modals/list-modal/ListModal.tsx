import { type ReactNode, type Ref } from "react";
import ModalTitle from "@/components/modal/modal-title/ModalTitle";
import InternalListModalInputField from "./internal/InternalListModalInputField";
import InternalListModalRepeater from "./internal/InternalListModalRepeater";
import useInternalListModalInteractions from "../../../hooks/modals/useInternalListModalInteractions";
import { useModalLifecycle } from "../../../hooks/modals/useModalLifecycle";

export interface ListModalItem {
    id: number;
    name: string;
}

export interface ListModalAction {
    icon: string;
    title: string;
    onClick: (id: number) => void;
    variant?: "danger" | "default";
}

export interface ListModalInputConfig {
    label?: string;
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    onConfirm?: () => void;
}

export interface ListModalProps {
    isOpen: boolean;
    title: string;
    shortcutToken: string;
    onClose: () => void;
    items: ListModalItem[];
    selectedId?: number | null;
    activeId?: number | null;
    onSelect?: (id: number) => void;
    onDoubleClick?: (id: number) => void;
    doubleClickLabel?: string;
    actions?: ListModalAction[];
    emptyMessage?: string;
    isLoading?: boolean;
    loadingMessage?: string;
    onClearSelection?: () => void;
    footerStart?: ReactNode;
    footerEnd?: ReactNode;
    input?: ListModalInputConfig;
    /** Ref to the input field of `input`. Kept out of `input`: a ref inside a plain object makes the React Compiler treat the whole object as a ref. */
    inputRef?: Ref<HTMLInputElement>;
    children?: ReactNode;
    widthClassName?: string;
}

export default function ListModal({
    isOpen,
    title,
    shortcutToken,
    onClose,
    items,
    selectedId,
    activeId,
    onSelect,
    onDoubleClick,
    doubleClickLabel = "Open",
    actions = [],
    emptyMessage = "No items",
    isLoading = false,
    loadingMessage = "Loading...",
    onClearSelection,
    footerStart,
    footerEnd,
    input,
    inputRef,
    children,
    widthClassName = "w-130",
}: ListModalProps) {
    const { handleBackdropMouseDown } = useModalLifecycle({
        isOpen,
        shortcutToken,
        onClose,
    });
    const {
        openMenuId,
        menuPos,
        closeMenu,
        handleMoreClick,
        handlePanelMouseDown,
    } = useInternalListModalInteractions({
        isOpen,
        selectedId,
        onSelect,
        onClearSelection,
    });

    if (!isOpen) return null;

    const hasFooter = Boolean(footerStart) || Boolean(footerEnd);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-overlay select-none"
            onMouseDown={handleBackdropMouseDown}
        >
            <div
                className={`flex flex-col ${widthClassName} bg-raised rounded-lg shadow-xl overflow-hidden`}
                onMouseDown={handlePanelMouseDown}
            >
                <ModalTitle title={title} onClose={onClose} />

                <InternalListModalRepeater
                    items={items}
                    selectedId={selectedId}
                    activeId={activeId}
                    onSelect={onSelect}
                    onDoubleClick={onDoubleClick}
                    doubleClickLabel={doubleClickLabel}
                    actions={actions}
                    emptyMessage={emptyMessage}
                    isLoading={isLoading}
                    loadingMessage={loadingMessage}
                    openMenuId={openMenuId}
                    menuPos={menuPos}
                    onMoreClick={handleMoreClick}
                    onCloseMenu={closeMenu}
                />

                {input ? (
                    <InternalListModalInputField
                        ref={inputRef}
                        label={input.label}
                        value={input.value}
                        placeholder={input.placeholder}
                        onChange={input.onChange}
                        onConfirm={input.onConfirm}
                    />
                ) : null}

                {children}

                {hasFooter && (
                    <div className={`flex items-center gap-2 px-4 py-3 ${footerStart ? "justify-between" : "justify-end"}`}>
                        {footerStart ?? <div />}
                        {footerEnd ? <div className="flex items-center gap-2">{footerEnd}</div> : null}
                    </div>
                )}
            </div>
        </div>
    );
}
