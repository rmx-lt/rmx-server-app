import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ModalTitle from "@/components/modal/modal-title/ModalTitle";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";
import { useModalLifecycle } from "../../../hooks/modals/useModalLifecycle";

export default function ConfirmationModal() {
    const {
        isOpen,
        title,
        message,
        tone,
        confirmLabel,
        cancelLabel,
        secondaryLabel,
        confirmDisabled,
        confirm,
        secondary,
        cancel,
    } = useConfirmationModalStore();

    const { handleBackdropMouseDown } = useModalLifecycle({
        isOpen,
        shortcutToken: "confirmation-modal",
        onClose: cancel,
    });

    const confirmVariant = tone === "danger"
        ? "danger"
        : "primary";

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 select-none"
            onMouseDown={handleBackdropMouseDown}
        >
            <div className="flex flex-col w-100 bg-gray-100 rounded-lg shadow-xl overflow-hidden">
                <ModalTitle title={title} onClose={cancel} />

                <p className="px-5 pt-3 pb-5 text-sm text-gray-500 whitespace-pre-wrap">
                    {message}
                </p>

                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200">
                    <ModalFooterButton variant={confirmVariant} disabled={confirmDisabled} onClick={() => confirm().catch(console.error)}>
                        {confirmLabel}
                    </ModalFooterButton>
                    {secondaryLabel && (
                        <ModalFooterButton onClick={() => secondary().catch(console.error)}>
                            {secondaryLabel}
                        </ModalFooterButton>
                    )}
                    <ModalFooterButton onClick={cancel}>
                        {cancelLabel}
                    </ModalFooterButton>
                </div>
            </div>
        </div>
    );
}
