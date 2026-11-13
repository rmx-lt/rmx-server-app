import { useCallback, useEffect, useMemo, useState } from "react";
import { useAlgorithmCardStore } from "@/features/computation-provider/stores/algorithmCardStore";
import type {
    CardModalFastTabConfig,
    CardModalHeaderConfig,
    CardModalListPartConfig,
    CardModalListPartRowId,
} from "@/components/modals/card-modal/CardModal";
import {
    ALGORITHM_LAYER_COLUMNS,
    ALGORITHM_PARAMETER_COLUMNS,
    buildLayerRows,
    buildParameterRows,
} from "@/features/computation-provider/utils/algorithmSectionModel";
import { useComputationCatalogStore } from "@/model/computationCatalogStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import type { LayerRecord, LayerSettingsSetup } from "@/data/local/layerTypes";
import { POINT_LABEL_ENUM_VALUES_SETUP_ID } from "@/config/computation/supportedLayerAttributes";

const DEFAULT_FAST_TAB_OPEN_STATE: Record<string, boolean> = { general: true, parameters: true, layers: true };

export function useAlgorithmCardController() {
    const { isOpen, algorithmDetails, isDraft, onDraftSave, close } = useAlgorithmCardStore();

    const [isSaving, setIsSaving] = useState(false);

    const [fastTabOpen, setFastTabOpen] = useState<Record<string, boolean>>(DEFAULT_FAST_TAB_OPEN_STATE);
    const [paramExpanded, setParamExpanded] = useState<Record<string, boolean>>({});
    const [layerExpanded, setLayerExpanded] = useState<Record<string, boolean>>({});
    const [pointLabelEnumExpanded, setPointLabelEnumExpanded] = useState<Record<string, boolean>>({});
    const [selectedParameterRowIds, setSelectedParameterRowIds] = useState<CardModalListPartRowId[]>([]);
    const [selectedLayerRowIds, setSelectedLayerRowIds] = useState<CardModalListPartRowId[]>([]);

    const algorithm = algorithmDetails?.algorithm ?? null;
    const parameters = algorithmDetails?.parameters ?? [];
    const layers = algorithmDetails?.layers ?? [];

    const allLayerSettings = useLayerSettingsStore((s) => s.layers);
    const layerSettingsSetup = useComputationCatalogStore((s) => s.layerSettingsSetup);

    useEffect(() => {
        if (!isOpen) {
            setFastTabOpen(DEFAULT_FAST_TAB_OPEN_STATE);
            setParamExpanded({});
            setLayerExpanded({});
            setPointLabelEnumExpanded({});
            setSelectedParameterRowIds([]);
            setSelectedLayerRowIds([]);
            setIsSaving(false);
        }
    }, [isOpen]);

    const handleClose = useCallback(() => {
        close();
    }, [close]);

    const handleSave = useCallback(async () => {
        if (!onDraftSave || !algorithmDetails) return;
        setIsSaving(true);
        try {
            const ok = await onDraftSave(algorithmDetails);
            if (ok) {
                useAlgorithmCardStore.getState().openSaved(algorithmDetails);
            }
        } finally {
            setIsSaving(false);
        }
    }, [algorithmDetails, onDraftSave]);

    const toggleFastTab = useCallback((key: string) => {
        setFastTabOpen((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const toggleParamSection = useCallback((rowId: string | number) => {
        const key = String(rowId);
        setParamExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
    }, []);

    const toggleLayerSection = useCallback((rowId: string | number) => {
        const key = String(rowId);
        setLayerExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
    }, []);

    const togglePointLabelEnumSection = useCallback((rowId: string | number) => {
        const key = String(rowId);
        setPointLabelEnumExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
    }, []);

    const canSave = isDraft && algorithmDetails !== null;
    const savedState = isSaving ? "saving" : isDraft ? "unsaved" : algorithm !== null ? "saved" : "nothing_to_save";

    const headerConfig = useMemo<CardModalHeaderConfig>(() => ({
        recordId: algorithm?.id ?? null,
        recordName: algorithm?.name ?? "",
        savedState,
        onSave: handleSave,
        canSave,
        isEditMode: false,
        onEdit: () => undefined,
        onNew: () => undefined,
        onDelete: () => undefined,
        canEdit: false,
        canNew: false,
        canDelete: false,
    }), [algorithm, canSave, handleSave, isDraft, savedState]);

    const parametersListPartRows = useMemo(
        () => {
            if (!algorithm) return [];
            return buildParameterRows(algorithm.id, parameters).map((row) => {
                if (row.kind !== "group") return row;
                const key = String(row.id);
                return {
                    ...row,
                    expanded: paramExpanded[key] ?? true,
                    onToggle: () => toggleParamSection(row.id),
                };
            });
        },
        [algorithm, paramExpanded, parameters, toggleParamSection],
    );

    const parametersListPart = useMemo<CardModalListPartConfig>(() => ({
        columns: ALGORITHM_PARAMETER_COLUMNS,
        rows: parametersListPartRows,
        emptyMessage: "No parameters defined for this algorithm.",
        maxHeightClassName: "max-h-96",
        storageKey: "algorithm-parameters",
        selectedRowIds: selectedParameterRowIds,
        onSelectedRowIdsChange: setSelectedParameterRowIds,
    }), [parametersListPartRows, selectedParameterRowIds]);

    const algorithmLayers = useMemo((): LayerRecord[] => {
        if (!algorithm) return [];
        const fromStore = allLayerSettings
            .map((l) => l.layer)
            .filter((l) => l.algorithmId === algorithm.id && l.providerId === algorithm.computationProviderId);
        if (fromStore.length > 0) return fromStore;
        // Draft/unsaved mode: derive LayerRecord stubs directly from algorithmDetails.layers
        return layers.map((l) => ({
            id: l.id,
            algorithmId: l.algorithmId,
            providerId: l.providerId,
            key: l.id,
            label: l.name,
            type: l.layerType,
        }));
    }, [algorithm, allLayerSettings, layers]);

    const layersListPartRows = useMemo(
        () => {
            if (!algorithm) return [];
            let filteredSetups: LayerSettingsSetup[] = layerSettingsSetup.filter(
                (s) => s.algorithmId === algorithm.id && s.providerId === algorithm.computationProviderId,
            );
            // Draft/unsaved mode: derive LayerSettingsSetup stubs from style attributes
            if (filteredSetups.length === 0 && layers.length > 0) {
                let idx = 0;
                filteredSetups = layers.flatMap((l) => {
                    const styleRows: LayerSettingsSetup[] = [
                        ...l.generalStyleAttributes.map((attr) => ({ ...attr, styleGroup: "general" as const })),
                        ...l.pointStyleAttributes.map((attr) => ({ ...attr, styleGroup: "point" as const })),
                        ...l.lineStyleAttributes.map((attr) => ({ ...attr, styleGroup: "line" as const })),
                        ...l.polygonStyleAttributes.map((attr) => ({ ...attr, styleGroup: "polygon" as const })),
                    ].map((attr): LayerSettingsSetup => ({
                        id: idx++,
                        layerId: l.id,
                        algorithmId: l.algorithmId,
                        providerId: l.providerId,
                        key: attr.key,
                        styleType: attr.styleType,
                        styleGroup: attr.styleGroup,
                        defaultValue: attr.defaultValue,
                    }));
                    if (l.pointLabelEnumValues.length > 0) {
                        styleRows.unshift({
                            id: POINT_LABEL_ENUM_VALUES_SETUP_ID,
                            layerId: l.id,
                            algorithmId: l.algorithmId,
                            providerId: l.providerId,
                            key: "Point Label Enum Values",
                            styleType: "PointLabelEnum",
                            styleGroup: "point",
                            defaultValue: l.pointLabelEnumValues.join(", "),
                            enumValues: l.pointLabelEnumValues,
                            mapping: l.pointLabelColorMapping,
                        });
                    }
                    return styleRows;
                });
            }
            return buildLayerRows(
                algorithm.id,
                algorithm.computationProviderId,
                algorithmLayers,
                filteredSetups,
                layerExpanded,
                toggleLayerSection,
                pointLabelEnumExpanded,
                togglePointLabelEnumSection,
            );
        },
        [algorithm, algorithmLayers, layerExpanded, layerSettingsSetup, layers, pointLabelEnumExpanded, toggleLayerSection, togglePointLabelEnumSection],
    );

    const layersListPart = useMemo<CardModalListPartConfig>(() => ({
        columns: ALGORITHM_LAYER_COLUMNS,
        rows: layersListPartRows,
        emptyMessage: "No layers defined for this algorithm.",
        maxHeightClassName: "max-h-96",
        storageKey: "algorithm-layers",
        selectedRowIds: selectedLayerRowIds,
        onSelectedRowIdsChange: setSelectedLayerRowIds,
    }), [layersListPartRows, selectedLayerRowIds]);

    const fastTabs = useMemo<CardModalFastTabConfig[]>(() => [
        {
            id: "general",
            title: "General",
            expanded: !!fastTabOpen.general,
            onToggle: () => toggleFastTab("general"),
            fields: [
                {
                    id: "name",
                    label: "Name",
                    value: algorithm?.name ?? "",
                    disabled: true,
                },
                {
                    id: "parameter-count",
                    label: "Number of Parameters",
                    value: String(parameters.length),
                    disabled: true,
                },
                {
                    id: "layer-count",
                    label: "Number of Layers",
                    value: String(algorithmLayers.length),
                    disabled: true,
                },
            ],
        },
        {
            id: "parameters",
            title: "Parameters",
            expanded: !!fastTabOpen.parameters,
            onToggle: () => toggleFastTab("parameters"),
            listPart: parametersListPart,
        },
        {
            id: "layers",
            title: "Layers",
            expanded: !!fastTabOpen.layers,
            onToggle: () => toggleFastTab("layers"),
            listPart: layersListPart,
        },
    ], [algorithm, algorithmLayers, fastTabOpen.general, fastTabOpen.layers, fastTabOpen.parameters, layersListPart, parameters.length, parametersListPart, toggleFastTab]);

    return {
        isOpen,
        isConfirmationModalOpen: false,
        handleClose,
        headerConfig,
        fastTabs,
    };
}
