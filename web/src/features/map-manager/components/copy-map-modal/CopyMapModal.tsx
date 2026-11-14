import { useEffect, useRef } from "react";
import { useCopyMapModalStore } from "@/features/map-manager/stores/copyMapModalStore";
import { useMapStore } from "@/model/mapStore";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ListModal, { type ListModalInputConfig } from "@/components/modals/list-modal/ListModal";

export default function CopyMapModal() {
    const { isOpen, name, maps, isCopying, setName, copy, close } = useCopyMapModalStore();
    const currentMapId = useMapStore((s) => s.map.id);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) setTimeout(() => { inputRef.current?.select(); }, 0);
    }, [isOpen]);

    function handleCopy() {
        copy().catch(console.error);
    }

    const canCopy = name.trim().length > 0 && !isCopying;
    const input: ListModalInputConfig = {
        value: name,
        placeholder: "Enter map name",
        onChange: setName,
        onConfirm: () => { if (canCopy) handleCopy(); },
    };

    return (
        <ListModal
            isOpen={isOpen}
            title="Make a Copy"
            shortcutToken="copy-map-modal"
            onClose={close}
            items={maps}
            activeId={currentMapId}
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
            inputRef={inputRef}
        />
    );
}
