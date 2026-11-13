import CardModal from "@/components/modals/card-modal/CardModal";
import { useAlgorithmCardController } from "@/features/computation-provider/hooks/useAlgorithmCardController";

// ─── AlgorithmCardModal ───────────────────────────────────────────────────────

export default function AlgorithmCardModal() {
    const {
        isOpen,
        isConfirmationModalOpen,
        handleClose,
        headerConfig,
        fastTabs,
    } = useAlgorithmCardController();

    return (
        <CardModal
            isOpen={isOpen}
            title="Algorithm"
            shortcutToken="algorithm-card"
            onClose={handleClose}
            canCloseOnEscape={!isConfirmationModalOpen}
            header={headerConfig}
            fastTabs={fastTabs}
        />
    );
}
