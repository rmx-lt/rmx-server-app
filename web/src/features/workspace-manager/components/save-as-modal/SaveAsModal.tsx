import { useEffect, useRef } from "react";
import { useSaveAsModalStore } from "@/features/workspace-manager/stores/saveAsModalStore";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ListModal, { type ListModalInputConfig } from "@/components/modals/list-modal/ListModal";
import { useEnvStore } from "@/model/envStore";

export default function SaveAsModal() {
    const currentEnvId = useEnvStore((s) => s.env.id);
    const { isOpen, environments, name, selectedEnvId, isSaving, setName, selectEnv, save, close } =
        useSaveAsModalStore();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) setTimeout(() => { inputRef.current?.select(); }, 0);
    }, [isOpen]);

    function handleSave() {
        save().catch(console.error);
    }

    const canSave = name.trim().length > 0 && !isSaving;
    const input: ListModalInputConfig = {
        inputRef,
        value: name,
        placeholder: "Enter workspace name",
        onChange: setName,
        onConfirm: () => { if (canSave) handleSave(); },
    };

    return (
        <ListModal
            isOpen={isOpen}
            title="Save As"
            shortcutToken="save-as-modal"
            onClose={close}
            items={environments}
            selectedId={selectedEnvId}
            activeId={currentEnvId}
            onSelect={selectEnv}
            onClearSelection={() => {
                if (selectedEnvId !== null) {
                    selectEnv(selectedEnvId);
                }
            }}
            footerEnd={(
                <>
                    <ModalFooterButton variant="primary" onClick={handleSave} disabled={!canSave}>
                        {isSaving ? "Saving..." : "Save"}
                    </ModalFooterButton>
                    <ModalFooterButton onClick={close} disabled={isSaving}>
                        Cancel
                    </ModalFooterButton>
                </>
            )}
            input={input}
        />
    );
}
