import { createElement } from "react";
import type { CardModalListPartColumn, CardModalListPartGroupRow, CardModalListPartRecordRow, CardModalListPartRow } from "@/components/modals/card-modal/CardModalListPart.types";
import type { AlgorithmParameter, ComputationAlgorithm, ComputationAlgorithmDetails, MetadataParamSection } from "@/data/local/serviceTypes";
import type { LayerRecord, LayerSettingsSetup } from "@/data/local/layerTypes";

export const ALGORITHM_LIST_COLUMNS: CardModalListPartColumn[] = [
    { id: "name", title: "Name", width: 220 },
    { id: "parameterCount", title: "Number of Parameters", width: 180 },
    { id: "layerCount", title: "Number of Layers", width: 160 },
];

export const ALGORITHM_PARAMETER_COLUMNS: CardModalListPartColumn[] = [
    { id: "name", title: "Name", width: 220 },
    { id: "type", title: "Type", width: 120 },
    { id: "enumValues", title: "Enum Values", width: 240 },
    { id: "defaultValue", title: "Default Value", width: 180 },
    { id: "appHandler", title: "App Handler", width: 220 },
];

export const ALGORITHM_LAYER_COLUMNS: CardModalListPartColumn[] = [
    { id: "name", title: "Name", width: 220 },
    { id: "type", title: "Type", width: 270 },
    { id: "defaultValue", title: "Default Value", width: 180 },
];

interface BuildSavedAlgorithmDetailsOptions {
    algorithms?: ComputationAlgorithm[];
    algorithmParameters?: AlgorithmParameter[];
}

interface BuildAlgorithmSectionRowsOptions {
    algorithmDetails: ComputationAlgorithmDetails[];
    isDraft: boolean;
    layerCountByAlgorithmId?: ReadonlyMap<number, number>;
    onAlgorithmClick?: (details: ComputationAlgorithmDetails) => void;
}

function normalizeSection(section: MetadataParamSection | undefined): MetadataParamSection {
    const trimmedSection = section?.trim();
    return trimmedSection ? trimmedSection : "General";
}

function buildParameterRecordRow(algorithmId: number, parameter: AlgorithmParameter): CardModalListPartRow {
    return {
        kind: "record",
        id: `algorithm-${algorithmId}-parameter-${parameter.id}`,
        recordId: parameter.id,
        cells: {
            name: {
                value: parameter.name,
                title: parameter.name,
            },
            type: {
                value: parameter.paramType,
                mono: true,
            },
            defaultValue: parameter.defaultValue
                ? {
                    value: parameter.defaultValue,
                    title: parameter.defaultValue,
                }
                : {
                    value: "—",
                    tone: "subtle",
                },
            enumValues: parameter.enumValues.length > 0
                ? {
                    value: parameter.enumValues.join(", "),
                    title: parameter.enumValues.join(", "),
                }
                : {
                    value: "—",
                    tone: "subtle",
                },
            appHandler: parameter.appHandler
                ? {
                    value: parameter.appHandler,
                    title: parameter.appHandler,
                    mono: true,
                }
                : {
                    value: "—",
                    tone: "subtle",
                },
        },
    };
}

export function buildParameterRows(algorithmId: number, parameters: AlgorithmParameter[]): CardModalListPartRow[] {
    const parametersBySection = new Map<MetadataParamSection, AlgorithmParameter[]>();

    for (const parameter of parameters) {
        const section = normalizeSection(parameter.section);
        const sectionParameters = parametersBySection.get(section);

        if (sectionParameters) {
            sectionParameters.push(parameter);
            continue;
        }

        parametersBySection.set(section, [parameter]);
    }

    return Array.from(parametersBySection.entries()).map(([section, sectionParameters]) => {
        const sectionRow: CardModalListPartGroupRow = {
            kind: "group",
            id: `algorithm-${algorithmId}-section-${section}`,
            label: section,
            expanded: true,
            onToggle: () => undefined,
            children: sectionParameters.map((parameter) => buildParameterRecordRow(algorithmId, parameter)),
        };

        return sectionRow;
    });
}

export function buildSavedAlgorithmDetails({
    algorithms,
    algorithmParameters,
}: BuildSavedAlgorithmDetailsOptions): ComputationAlgorithmDetails[] {
    if (!algorithms) {
        return [];
    }

    const parametersByAlgorithmId = new Map<number, AlgorithmParameter[]>();

    for (const parameter of algorithmParameters ?? []) {
        const existingParameters = parametersByAlgorithmId.get(parameter.algorithmId);

        if (existingParameters) {
            existingParameters.push(parameter);
            continue;
        }

        parametersByAlgorithmId.set(parameter.algorithmId, [parameter]);
    }

    return algorithms.map((algorithm) => ({
        algorithm,
        parameters: parametersByAlgorithmId.get(algorithm.id) ?? [],
        layers: [],
        metrics: [],
    }));
}

export function buildAlgorithmSectionRows({
    algorithmDetails,
    isDraft,
    layerCountByAlgorithmId,
    onAlgorithmClick,
}: BuildAlgorithmSectionRowsOptions): CardModalListPartRow[] {
    return algorithmDetails.map((details): CardModalListPartRecordRow => {
        const { algorithm, parameters, layers } = details;
        const rowId = isDraft ? `draft-algorithm-${algorithm.id}-${algorithm.name}` : `algorithm-${algorithm.id}-${algorithm.computationProviderId}`;

        const layerCount = layerCountByAlgorithmId?.get(algorithm.id) ?? layers.length;

        const nameCell = onAlgorithmClick
            ? createElement(
                "span",
                {
                    className: "cursor-pointer hover:underline",
                    onClick: (e: MouseEvent) => {
                        e.stopPropagation();
                        onAlgorithmClick(details);
                    },
                },
                algorithm.name,
            )
            : algorithm.name;

        const algorithmRow: CardModalListPartRecordRow = {
            kind: "record",
            id: rowId,
            recordId: algorithm.id,
            cells: {
                name: { value: nameCell, title: algorithm.name },
                parameterCount: { value: String(parameters.length) },
                layerCount: { value: String(layerCount) },
            },
            actions: onAlgorithmClick
                ? [
                    {
                        id: "open",
                        icon: "open_in_new",
                        title: "Open",
                        onClick: () => onAlgorithmClick(details),
                    },
                ]
                : undefined,
        };

        return algorithmRow;
    });
}

function buildLayerSettingRows(
    algorithmId: number,
    providerId: number,
    layerSetupId: number,
    setups: LayerSettingsSetup[],
    pointLabelEnumExpanded: Record<string, boolean>,
    togglePointLabelEnumSection: (rowId: string | number) => void,
): CardModalListPartRow[] {
    const layerSetups = setups.filter(
        (s) => s.layerId === layerSetupId && s.algorithmId === algorithmId && s.providerId === providerId,
    );

    const pointLabelEnumSetup = layerSetups.find((s) => s.styleType === "PointLabelEnum");
    const regularSetups = layerSetups.filter((s) => s.styleType !== "PointLabelEnum");

    const rows: CardModalListPartRow[] = [];

    if (pointLabelEnumSetup != null) {
        const groupRowId = `layer-${layerSetupId}-${algorithmId}-${providerId}-point-label-enum`;
        const colorMappingChildren: CardModalListPartRow[] = (pointLabelEnumSetup.mapping ?? []).map(
            (entry): CardModalListPartRecordRow => ({
                kind: "record",
                id: `${groupRowId}-color-mapping-${entry.value}`,
                cells: {
                    name: { value: entry.value, title: entry.value },
                    type: { value: "Color", mono: true },
                    defaultValue: entry.color != null
                        ? { value: entry.color, title: entry.color }
                        : { value: "—", tone: "subtle" },
                },
            }),
        );
        const pointLabelGroupRow: CardModalListPartGroupRow = {
            kind: "group",
            id: groupRowId,
            label: "Point Label Enum Values",
            cells: {
                type: { value: "Enum", mono: true },
                defaultValue: undefined,
            },
            expanded: pointLabelEnumExpanded[groupRowId] ?? true,
            onToggle: () => togglePointLabelEnumSection(groupRowId),
            children: colorMappingChildren,
        };
        rows.push(pointLabelGroupRow);
    }

    for (const setup of regularSetups) {
        rows.push({
            kind: "record",
            id: `layer-${layerSetupId}-setup-${setup.id}`,
            cells: {
                name: { value: setup.key },
                type: { value: setup.styleType, mono: true },
                defaultValue: setup.defaultValue != null
                    ? { value: setup.defaultValue }
                    : { value: "—", tone: "subtle" },
            },
        });
    }

    return rows;
}

export function buildLayerRows(
    algorithmId: number,
    providerId: number,
    layers: LayerRecord[],
    setups: LayerSettingsSetup[],
    layerExpanded: Record<string, boolean>,
    toggleLayerSection: (rowId: string | number) => void,
    pointLabelEnumExpanded: Record<string, boolean>,
    togglePointLabelEnumSection: (rowId: string | number) => void,
): CardModalListPartRow[] {
    return layers.map((layer): CardModalListPartGroupRow => {
        const rowId = `layer-${layer.id}-${algorithmId}-${providerId}`;
        return {
            kind: "group",
            id: rowId,
            label: layer.label,
            cells: {
                type: layer.type != null
                    ? { value: layer.type, mono: true }
                    : { value: "—", tone: "subtle" },
                defaultValue: undefined,
            },
            expanded: layerExpanded[rowId] ?? true,
            onToggle: () => toggleLayerSection(rowId),
            children: buildLayerSettingRows(algorithmId, providerId, layer.id, setups, pointLabelEnumExpanded, togglePointLabelEnumSection),
        };
    });
}
