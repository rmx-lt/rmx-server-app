import { useEffect, useRef } from "react";
import { useCopyWorkspaceModalStore } from "@/features/workspace-manager/stores/copyWorkspaceModalStore";
import { useEnvStore } from "@/model/envStore";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ListModal, { type ListModalInputConfig } from "@/components/modals/list-modal/ListModal";

export default function CopyWorkspaceModal() {
    const { isOpen, name, environments, isCopying, setName, copy, close } = useCopyWorkspaceModalStore();
    const currentEnvId = useEnvStore((s) => s.env.id);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) setTimeout(() => { inputRef.current?.select(); }, 0);
    }, [isOpen]);

    function handleCopy() {
        copy().catch(console.error);
    }

    const canCopy = name.trim().length > 0 && !isCopying;
    const input: ListModalInputConfig = {
        inputRef,
        value: name,
        placeholder: "Enter workspace name",
        onChange: setName,
        onConfirm: () => { if (canCopy) handleCopy(); },
    };

    return (
        <ListModal
            isOpen={isOpen}
            title="Make a Copy"
            shortcutToken="copy-workspace-modal"
            onClose={close}
            items={environments}
            activeId={currentEnvId}
            footerEnd={(
                <>
                    <ModalFooterButton variant="primary" onClick={handleCopy} disabled={!canCopy}>
                        {isCopying ? "Copying..." : "Copy"}
                    </ModalFooterButton>
                    <ModalFooterButton onClick={close} disabled={isCopying}>
                        Cancel
                    </ModalFooterButton>
                </>
            )}
            input={input}
        />
    );
}
