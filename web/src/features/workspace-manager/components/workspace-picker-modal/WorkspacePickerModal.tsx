import { useEffect, useState } from "react";
import { useWorkspacePickerStore } from "@/features/workspace-manager/stores/workspacePickerStore";
import { useSaveModalStore } from "@/features/workspace-manager/stores/saveModalStore";
import { useDeleteModalStore } from "@/features/workspace-manager/stores/deleteModalStore";
import { listMaps, deleteMap, type MapListItem } from "@/data/planning/maps";
import { loadWorkspace, resetWorkspace } from "@/features/workspace-manager/data/workspaceBridge";
import { useEnvStore } from "@/model/envStore";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ListModal, { type ListModalAction } from "@/components/modals/list-modal/ListModal";

export default function WorkspacePickerModal() {
    const isOpen = useWorkspacePickerStore((s) => s.isOpen);
    const close = useWorkspacePickerStore((s) => s.close);
    const currentEnvId = useEnvStore((s) => s.env.id);

    const [environments, setEnvironments] = useState<MapListItem[]>([]);
    const [isLoading, setIsLoading] = useState(isOpen);
    const [selectedEnvId, setSelectedEnvId] = useState<number | null>(null);

    // Opening starts a load; closing drops the selection (adjusted during render, not in an effect).
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) setIsLoading(true);
        else setSelectedEnvId(null);
    }

    useEffect(() => {
        if (!isOpen) return;
        listMaps()
            .then(setEnvironments)
            .catch((err: unknown) => {
                console.error(err);
                setEnvironments([]);
            })
            .finally(() => setIsLoading(false));
    }, [isOpen]);

    function handleOpenById(id: number) {
        // The open map can be opened again: that loads the server's version
        // (after a save was refused because it changed elsewhere).
        const env = environments.find((e) => e.id === id);
        if (!env) return;
        useSaveModalStore.getState().requestWithSaveGuard(async () => {
            await loadWorkspace(env.id);
            close();
        });
    }

    function handleDelete(id: number) {
        const env = environments.find((e) => e.id === id);
        if (!env) return;
        useDeleteModalStore.getState().requestDelete(env.name, async () => {
            await deleteMap(env.id);
            setEnvironments((prev) => prev.filter((e) => e.id !== env.id));
            setSelectedEnvId((prev) => (prev === env.id ? null : prev));
            if (env.id === currentEnvId) {
                await resetWorkspace();
            }
        });
    }

    const canOpen = selectedEnvId !== null;
    const actions: ListModalAction[] = [{ icon: "delete", title: "Delete", variant: "danger", onClick: handleDelete }];

    return (
        <ListModal
            isOpen={isOpen}
            title="Open Workspace"
            shortcutToken="workspace-picker-modal"
            onClose={close}
            items={environments}
            selectedId={selectedEnvId}
            activeId={currentEnvId}
            onSelect={setSelectedEnvId}
            onDoubleClick={handleOpenById}
            doubleClickLabel="Open"
            actions={actions}
            emptyMessage="No saved workspaces"
            isLoading={isLoading}
            loadingMessage="Loading..."
            onClearSelection={() => setSelectedEnvId(null)}
            footerEnd={(
                <>
                    <ModalFooterButton
                        variant="primary"
                        onClick={() => selectedEnvId !== null && handleOpenById(selectedEnvId)}
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
