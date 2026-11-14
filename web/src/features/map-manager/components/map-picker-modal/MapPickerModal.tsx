import { useEffect, useState } from "react";
import { useMapPickerStore } from "@/features/map-manager/stores/mapPickerStore";
import { useSaveModalStore } from "@/features/map-manager/stores/saveModalStore";
import { useDeleteModalStore } from "@/features/map-manager/stores/deleteModalStore";
import { listMaps, deleteMap, type MapListItem } from "@/data/planning/maps";
import { openMap, resetMap } from "@/features/map-manager/data/mapBridge";
import { useMapStore } from "@/model/mapStore";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ListModal, { type ListModalAction } from "@/components/modals/list-modal/ListModal";

export default function MapPickerModal() {
    const isOpen = useMapPickerStore((s) => s.isOpen);
    const close = useMapPickerStore((s) => s.close);
    const currentMapId = useMapStore((s) => s.map.id);

    const [maps, setMaps] = useState<MapListItem[]>([]);
    const [isLoading, setIsLoading] = useState(isOpen);
    const [selectedMapId, setSelectedMapId] = useState<number | null>(null);

    // Opening starts a load; closing drops the selection (adjusted during render, not in an effect).
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) setIsLoading(true);
        else setSelectedMapId(null);
    }

    useEffect(() => {
        if (!isOpen) return;
        listMaps()
            .then(setMaps)
            .catch((err: unknown) => {
                console.error(err);
                setMaps([]);
            })
            .finally(() => setIsLoading(false));
    }, [isOpen]);

    function handleOpenById(id: number) {
        // The open map can be opened again: that loads the server's version
        // (after a save was refused because it changed elsewhere).
        const map = maps.find((e) => e.id === id);
        if (!map) return;
        useSaveModalStore.getState().requestWithSaveGuard(async () => {
            await openMap(map.id);
            close();
        });
    }

    function handleDelete(id: number) {
        const map = maps.find((e) => e.id === id);
        if (!map) return;
        useDeleteModalStore.getState().requestDelete(map.name, async () => {
            await deleteMap(map.id);
            setMaps((prev) => prev.filter((e) => e.id !== map.id));
            setSelectedMapId((prev) => (prev === map.id ? null : prev));
            if (map.id === currentMapId) {
                await resetMap();
            }
        });
    }

    const canOpen = selectedMapId !== null;
    const actions: ListModalAction[] = [{ icon: "delete", title: "Delete", variant: "danger", onClick: handleDelete }];

    return (
        <ListModal
            isOpen={isOpen}
            title="Open Map"
            shortcutToken="map-picker-modal"
            onClose={close}
            items={maps}
            selectedId={selectedMapId}
            activeId={currentMapId}
            onSelect={setSelectedMapId}
            onDoubleClick={handleOpenById}
            doubleClickLabel="Open"
            actions={actions}
            emptyMessage="No saved maps"
            isLoading={isLoading}
            loadingMessage="Loading..."
            onClearSelection={() => setSelectedMapId(null)}
            footerEnd={(
                <>
                    <ModalFooterButton
                        variant="primary"
                        onClick={() => selectedMapId !== null && handleOpenById(selectedMapId)}
                        disabled={!canOpen}
                    >
                        Open
                    </ModalFooterButton>
                    <ModalFooterButton onClick={close}>Cancel</ModalFooterButton>
                </>
            )}
        />
    );
}
