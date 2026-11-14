import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import {
    ENV_TYPE_OPTIONS,
    defaultObjectTypeForEnv,
    isEnvTypeFixed,
    OBJECT_TYPE,
    type EnvType,
} from "@/config/db-ops/enums";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useEnvStore } from "@/model/envStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

export default function EnvTypeSelection() {
    const type = useEnvStore((state) => state.env.type);
    const setType = useEnvStore((state) => state.setType);
    const objects = useCanvasObjectStore((state) => state.objects);
    const updateObjectsType = useCanvasObjectStore((state) => state.updateObjectsType);

    function handleChange(newValue: string) {
        const nextType = newValue as EnvType;

        if (isEnvTypeFixed(nextType)) {
            const nextObjectType = defaultObjectTypeForEnv(nextType);
            const mismatchCount = objects.filter((object) => object.type !== nextObjectType).length;

            if (mismatchCount > 0) {
                const typeLabel = nextObjectType === OBJECT_TYPE.ONLINE ? "On-Line" : "Off-Line";
                useConfirmationModalStore.getState().requestConfirmation({
                    title: "Update object types",
                    message: `${mismatchCount} object${mismatchCount !== 1 ? "s" : ""} will be updated to "${typeLabel}" to match the new environment type. Continue?`,
                    tone: "warning",
                    confirmLabel: "Confirm",
                    cancelLabel: "Cancel",
                    confirmAction: async () => {
                        updateObjectsType(nextObjectType);
                        setType(nextType);
                    },
                });
                return;
            }

            updateObjectsType(nextObjectType);
        }

        setType(nextType);
    }

    return (
        <ControlsPanelSectionSelect
            label="Type"
            value={type}
            onChange={handleChange}
            options={ENV_TYPE_OPTIONS}
        />
    );
}
