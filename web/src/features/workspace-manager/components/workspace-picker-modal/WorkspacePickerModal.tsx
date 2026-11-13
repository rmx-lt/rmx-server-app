import { useEffect, useState } from "react";
import { useWorkspacePickerStore } from "@/features/workspace-manager/stores/workspacePickerStore";
import { useSaveModalStore } from "@/features/workspace-manager/stores/saveModalStore";
import { useDeleteModalStore } from "@/features/workspace-manager/stores/deleteModalStore";
import { getAllEnvironments, deleteEnvironment } from "@/data/local/environments";
import { loadWorkspace, resetWorkspace } from "@/features/workspace-manager/data/workspaceBridge";
import { useEnvStore } from "@/model/envStore";
import type { Environment } from "@/data/local/schemaTypes";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ListModal, { type ListModalAction } from "@/components/modals/list-modal/ListModal";

export default function WorkspacePickerModal() {
    const isOpen = useWorkspacePickerStore((s) => s.isOpen);
    const close = useWorkspacePickerStore((s) => s.close);
    const currentEnvId = useEnvStore((s) => s.env.id);

    const [environments, setEnvironments] = useState<Environment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedEnvId, setSelectedEnvId] = useState<number | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setSelectedEnvId(null);
            return;
        }
        setIsLoading(true);
        getAllEnvironments()
            .then(setEnvironments)
            .catch(console.error)
            .finally(() => setIsLoading(false));
    }, [isOpen]);

    function handleOpenById(id: number) {
        const env = environments.find((e) => e.id === id);
        if (!env || env.id === currentEnvId) return;
        useSaveModalStore.getState().requestWithSaveGuard(async () => {
            await loadWorkspace(env.id);
            close();
        });
    }

    function handleDelete(id: number) {
        const env = environments.find((e) => e.id === id);
        if (!env) return;
        useDeleteModalStore.getState().requestDelete(env.name, async () => {
            await deleteEnvironment(env);
            setEnvironments((prev) => prev.filter((e) => e.id !== env.id));
            setSelectedEnvId((prev) => (prev === env.id ? null : prev));
            if (env.id === currentEnvId) {
                await resetWorkspace();
            }
        });
    }

    const canOpen = selectedEnvId !== null && selectedEnvId !== currentEnvId;
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
