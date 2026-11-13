import CardModal from "@/components/modals/card-modal/CardModal";
import { useComputationProviderCardController } from "@/features/computation-provider/hooks/useComputationProviderCardController";

// ─── ComputationProviderCard ──────────────────────────────────────────────────

export default function ComputationProviderCard() {
    const {
        isOpen,
        isConfirmationModalOpen,
        handleClose,
        headerConfig,
        fastTabs,
        actionBarActions,
    } = useComputationProviderCardController();

    return (
        <CardModal
            isOpen={isOpen}
            title="Computation Provider"
            shortcutToken="computation-provider-card"
            onClose={handleClose}
            canCloseOnEscape={!isConfirmationModalOpen}
            header={headerConfig}
            actionBarActions={actionBarActions}
            fastTabs={fastTabs}
        />
    );
}
