import { useEffect, useRef } from "react";
import { useImportModalStore } from "@/features/workspace-manager/stores/importModalStore";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import ModalTitle from "@/components/modal/modal-title/ModalTitle";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import { useModalLifecycle } from "@/hooks/modals/useModalLifecycle";

export default function ImportModal() {
    const { isOpen, name, preview, isImporting, setName, confirm, close } = useImportModalStore();
    const inputRef = useRef<HTMLInputElement>(null);

    const { handleBackdropMouseDown } = useModalLifecycle({
        isOpen,
        shortcutToken: "import-modal",
        onClose: close,
        canCloseOnBackdrop: !isImporting,
        canCloseOnEscape: !isImporting,
    });

    useEffect(() => {
        if (isOpen) setTimeout(() => { inputRef.current?.select(); }, 0);
    }, [isOpen]);

    function handleConfirm() {
        confirm().catch(console.error);
    }

    const zoneCount = preview?.objects.filter((o) => o.category === OBJECT_CATEGORY.ZONE).length ?? 0;
    const obstacleCount = preview?.objects.filter((o) => o.category === OBJECT_CATEGORY.OBSTACLE).length ?? 0;
    const envPointCount = preview?.envPoints.length ?? 0;

    const canConfirm = name.trim().length > 0 && !isImporting;

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 select-none"
            onMouseDown={handleBackdropMouseDown}
        >
            <div className="flex flex-col w-100 bg-gray-100 rounded-lg shadow-xl overflow-hidden">
                <ModalTitle title="Import Workspace" onClose={close} />

                <div className="flex flex-col gap-3 px-5 pt-3 pb-5">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Workspace name
                        </label>
                        <input
                            ref={inputRef}
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && canConfirm) handleConfirm(); }}
                            placeholder="Enter workspace name"
                            disabled={isImporting}
                            className="w-full px-3 py-1.5 text-sm bg-white border border-gray-300 rounded focus:outline-none focus:border-teal-500 disabled:opacity-50"
                        />
                    </div>

                    <div className="flex gap-4 text-sm text-gray-500">
                        <span>
                            <span className="font-medium text-gray-700">{zoneCount}</span> zone{zoneCount !== 1 ? "s" : ""}
                        </span>
                        <span>
                            <span className="font-medium text-gray-700">{obstacleCount}</span> obstacle{obstacleCount !== 1 ? "s" : ""}
                        </span>
                        <span>
                            <span className="font-medium text-gray-700">{envPointCount}</span> point{envPointCount !== 1 ? "s" : ""}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200">
                    <ModalFooterButton variant="primary" onClick={handleConfirm} disabled={!canConfirm}>
                        {isImporting ? "Importing..." : "Import"}
                    </ModalFooterButton>
                    <ModalFooterButton onClick={close} disabled={isImporting}>
                        Cancel
                    </ModalFooterButton>
                </div>
            </div>
        </div>
    );
}
