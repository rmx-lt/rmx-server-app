import { useEffect, useRef } from "react";
import { useSaveAsModalStore } from "@/features/map-manager/stores/saveAsModalStore";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ListModal, { type ListModalInputConfig } from "@/components/modals/list-modal/ListModal";
import { useMapStore } from "@/model/mapStore";

export default function SaveAsModal() {
    const currentMapId = useMapStore((s) => s.map.id);
    const { isOpen, maps, name, selectedMapId, isSaving, setName, selectMap, save, close } =
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
        value: name,
        placeholder: "Enter map name",
        onChange: setName,
        onConfirm: () => { if (canSave) handleSave(); },
    };

    return (
        <ListModal
            isOpen={isOpen}
            title="Save As"
            shortcutToken="save-as-modal"
            onClose={close}
            items={maps}
            selectedId={selectedMapId}
            activeId={currentMapId}
            onSelect={selectMap}
            onClearSelection={() => {
                if (selectedMapId !== null) {
                    selectMap(selectedMapId);
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
            inputRef={inputRef}
        />
    );
}
