import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";

interface ModalFooterProps {
    onOk?: () => void;
    okLabel?: string;
    onCancel?: () => void;
    cancelLabel?: string;
}

export default function ModalFooter({
    onOk,
    okLabel = "OK",
    onCancel,
    cancelLabel = "Cancel",
}: ModalFooterProps) {
    return (
        <div className="flex items-center justify-end gap-2 px-4 py-3">
            {onCancel && (
                <ModalFooterButton onClick={onCancel}>
                    {cancelLabel}
                </ModalFooterButton>
            )}
            {onOk && (
                <ModalFooterButton onClick={onOk} variant="primary">
                    {okLabel}
                </ModalFooterButton>
            )}
        </div>
    );
}
