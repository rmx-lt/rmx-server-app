import { useEffect } from "react";
import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import {
    ENV_TYPE_OPTIONS,
    defaultObjectTypeForEnv,
    isEnvTypeFixed,
    OBJECT_TYPE,
    type EnvType,
} from "@/config/db-ops/enums";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useParameterValuesStore } from "@/model/parameterValuesStore";
import { useEnvStore } from "@/model/envStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

function envTypeToMetadataValue(type: EnvType): string {
    const matchingOption = ENV_TYPE_OPTIONS.find((option) => option.value === type);
    return matchingOption?.label ?? type;
}

interface EnvTypeSelectionProps {
    providerId?: number;
    algorithmId?: number;
    parameterId?: number;
    parameterName?: string;
    enumValues?: string[];
}

export default function EnvTypeSelection({
    providerId,
    algorithmId,
    parameterId,
    parameterName,
    enumValues,
}: EnvTypeSelectionProps) {
    const envId = useEnvStore((state) => state.env.id);
    const type = useEnvStore((state) => state.env.type);
    const setType = useEnvStore((state) => state.setType);
    const objects = useCanvasObjectStore((state) => state.objects);
    const updateObjectsType = useCanvasObjectStore((state) => state.updateObjectsType);
    const setParameterValue = useParameterValuesStore((state) => state.setParameterValue);

    useEffect(() => {
        if (providerId === undefined || algorithmId === undefined || parameterId === undefined) return;
        setParameterValue(parameterId, algorithmId, providerId, envId, envTypeToMetadataValue(type));
    }, [algorithmId, envId, parameterId, providerId, setParameterValue, type]);

    function applyType(nextType: EnvType) {
        setType(nextType);

        if (providerId !== undefined && algorithmId !== undefined && parameterId !== undefined) {
            setParameterValue(parameterId, algorithmId, providerId, envId, envTypeToMetadataValue(nextType));
        }
    }

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
                        applyType(nextType);
                    },
                });
                return;
            }

            updateObjectsType(nextObjectType);
        }

        applyType(nextType);
    }

    const options = enumValues === undefined
        ? ENV_TYPE_OPTIONS
        : ENV_TYPE_OPTIONS.filter((opt) => enumValues.includes(opt.label));

    return (
        <ControlsPanelSectionSelect
            label={parameterName ?? "Type"}
            value={type}
            onChange={handleChange}
            options={options}
        />
    );
}
