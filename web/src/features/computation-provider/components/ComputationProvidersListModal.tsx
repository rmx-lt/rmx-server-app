import { useEffect, useState } from "react";
import type { ComputationProvider } from "@/data/local/serviceTypes";
import { useComputationProvidersListModalStore } from "@/features/computation-provider/stores/computationProvidersListModalStore";
import { useComputationProviderCardStore } from "@/features/computation-provider/stores/computationProviderCardStore";
import { useComputationCatalogStore } from "@/model/computationCatalogStore";
import { useDeleteModalStore } from "@/features/workspace-manager/stores/deleteModalStore";
import { deleteProviderWithCleanup } from "@/features/computation-provider/data/computationProviderService";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import ListModal, { type ListModalAction } from "@/components/modals/list-modal/ListModal";

export default function ComputationProvidersListModal() {
    const { isOpen, close } = useComputationProvidersListModalStore();
    const openCard = useComputationProviderCardStore((s) => s.open);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const providers = useComputationCatalogStore((s) => s.providers);

    useEffect(() => {
        if (!isOpen) setSelectedId(null);
    }, [isOpen]);

    function handleView(id: number) {
        close();
        openCard(id);
    }

    function handleAdd() {
        close();
        openCard(null);
    }

    function handleDelete(id: number) {
        const provider = providers.find((p) => p.id === id);
        if (!provider) return;
        useDeleteModalStore.getState().requestDelete(provider.name, async () => {
            await deleteProviderWithCleanup(id);
        });
    }

    const actions: ListModalAction[] = [{ icon: "delete", title: "Delete", variant: "danger", onClick: handleDelete }];

    return (
        <ListModal
            isOpen={isOpen}
            title="Computation Providers"
            shortcutToken="computation-provider-list-modal"
            onClose={close}
            items={providers.filter((p): p is ComputationProvider & { id: number } => p.id !== undefined)}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDoubleClick={handleView}
            actions={actions}
            emptyMessage="No providers yet. Add one to get started."
            onClearSelection={() => setSelectedId(null)}
            footerStart={(
                <button
                    type="button"
                    onClick={handleAdd}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-teal-700 hover:bg-teal-50 rounded cursor-pointer transition-colors"
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                    Add Provider
                </button>
            )}
            footerEnd={<ModalFooterButton onClick={close}>Close</ModalFooterButton>}
        />
    );
}
