import { DialogTitle } from "@headlessui/react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

export default function ConfirmationModal() {
    const { isOpen, title, message, tone, confirmLabel, cancelLabel, secondaryLabel, confirmDisabled, confirm, secondary, cancel } =
        useConfirmationModalStore();

    return (
        <Modal open={isOpen} onClose={cancel} token="confirmation-modal" className="w-full max-w-sm">
            <div className="p-6">
                <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{message}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 px-6 pb-5">
                <Button onClick={cancel}>{cancelLabel}</Button>
                {secondaryLabel && <Button onClick={() => secondary().catch(console.error)}>{secondaryLabel}</Button>}
                <Button
                    variant={tone === "danger" ? "danger" : "primary"}
                    disabled={confirmDisabled}
                    onClick={() => confirm().catch(console.error)}
                >
                    {confirmLabel}
                </Button>
            </div>
        </Modal>
    );
}
