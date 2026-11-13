import { useEffect, useMemo, useState } from "react";
import ControlsPanelSection from "@/components/controls-panel/ControlsPanelSection";
import ControlsPanelSeparator from "@/components/controls-panel/ControlsPanelSeparator";
import ControlsPanelSectionCheckbox from "@/components/controls-panel/ControlsPanelSectionCheckbox";
import ControlsPanelSectionInput from "@/components/controls-panel/ControlsPanelSectionInput";
import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import { APP_PARAMETER_HANDLER } from "@/config/computation/appParameterHandlers";
import {
    ENV_FORMAT_OPTIONS,
    ENV_TYPE_OPTIONS,
    defaultObjectTypeForEnv,
    isEnvTypeFixed,
    OBJECT_TYPE,
    type CoordSystemType,
    type EnvFormat,
    type EnvType,
} from "@/config/db-ops/enums";
import CoordinateSystemSelect from "@/features/coverage-planning/components/controls-panel/env-section/CoordinateSystemSelect";
import FormatSelection from "@/features/coverage-planning/components/controls-panel/env-section/FormatSelect";
import EnvTypeSelection from "@/features/coverage-planning/components/controls-panel/env-section/EnvTypeSelect";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { useEnvStore } from "@/model/envStore";
import { useParameterValuesStore } from "@/model/parameterValuesStore";
import { useComputationCatalogStore } from "@/model/computationCatalogStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { LAYER_ID } from "@/config/layers/layerRegistry";
import type { AlgorithmParameter, AppEnumValue } from "@/data/local/serviceTypes";
import type { ComputationAlgorithmParameter } from "@/data/local/schemaTypes";
import {
    SYSTEM_HEADLAND_PROVIDER_PARAM_NAMES,
    parseHeadlandWidth,
} from "@/features/coverage-planning/utils/headlandGeometry";
import {
    type UnitOfMeasure,
    unitLabel,
} from "@/utils/unitOfMeasure";

interface ParameterSectionGroup {
    title: string;
    parameters: AlgorithmParameter[];
}

function normalizeSectionTitle(section?: string): string {
    const title = section?.trim();
    return title ? title : "General";
}

function parseBooleanParameterValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
}

function buildEnumOptionsFromValues(values: string[]): Array<{ value: string; label: string }> {
    return [{ value: "", label: "" }, ...values.map((value) => ({ value, label: value }))];
}

function groupParametersBySection(parameters: AlgorithmParameter[]): ParameterSectionGroup[] {
    const groupedSections = new Map<string, AlgorithmParameter[]>();

    parameters.forEach((parameter) => {
        const sectionTitle = normalizeSectionTitle(parameter.section);
        const sectionParameters = groupedSections.get(sectionTitle);

        if (sectionParameters) {
            sectionParameters.push(parameter);
            return;
        }

        groupedSections.set(sectionTitle, [parameter]);
    });

    return Array.from(groupedSections.entries()).map(([title, sectionParameters]) => ({
        title,
        parameters: sectionParameters,
    }));
}

function getParameterDisplayValue(
    parameter: AlgorithmParameter,
    parameterValues: ComputationAlgorithmParameter[],
): string {
    const persistedValue = parameterValues.find((pv) => pv.id === parameter.id)?.value;
    return persistedValue ?? parameter.defaultValue ?? "";
}

function getNumericParameterUnit(parameter: AlgorithmParameter, unitOfMeasure: UnitOfMeasure): string {
    if (parameter.unitType === "ratio") {
        return "%";
    }

    if (parameter.unitType === "unitless") {
        return "";
    }

    if (parameter.unitType === undefined) {
        return "";
    }

    return unitLabel(unitOfMeasure);
}

interface DynamicParameterFieldProps {
    parameter: AlgorithmParameter;
    selectedProviderId: number;
    selectedAlgorithmId: number;
    parameterValues: ComputationAlgorithmParameter[];
    appEnums: AppEnumValue[];
    unitOfMeasure: UnitOfMeasure;
    onChange: (parameterId: number, value: string) => void;
}

function DynamicParameterField({
    parameter,
    parameterValues,
    unitOfMeasure,
    onChange,
}: DynamicParameterFieldProps) {
    const value = getParameterDisplayValue(parameter, parameterValues);

    switch (parameter.appHandler) {
        case APP_PARAMETER_HANDLER.ENVIRONMENT_COORDSYSTEM:
        case APP_PARAMETER_HANDLER.ENVIRONMENT_FORMAT:
        case APP_PARAMETER_HANDLER.ENVIRONMENT_TYPE:
            // These are handled by the always-visible Environment section — never rendered here.
            return null;
    }

    switch (parameter.paramType) {
        case "Boolean":
            return (
                <ControlsPanelSectionCheckbox
                    label={parameter.name}
                    checked={parseBooleanParameterValue(value)}
                    onChange={(checked) => onChange(parameter.id, String(checked))}
                />
            );

        case "Enum":
            return (
                <ControlsPanelSectionSelect
                    label={parameter.name}
                    value={value}
                    onChange={(nextValue) => onChange(parameter.id, nextValue)}
                    options={buildEnumOptionsFromValues(parameter.enumValues)}
                />
            );

        case "Integer": {
            const integerUnit = getNumericParameterUnit(parameter, unitOfMeasure);
            return (
                <ControlsPanelSectionInput
                    label={integerUnit ? `${parameter.name} (${integerUnit})` : parameter.name}
                    value={value}
                    onChange={(nextValue) => onChange(parameter.id, nextValue)}
                    type="number"
                    min={parameter.minValue}
                    max={parameter.maxValue}
                />
            );
        }

        case "Decimal": {
            const decimalUnit = getNumericParameterUnit(parameter, unitOfMeasure);
            return (
                <ControlsPanelSectionInput
                    label={decimalUnit ? `${parameter.name} (${decimalUnit})` : parameter.name}
                    value={value}
                    onChange={(nextValue) => onChange(parameter.id, nextValue)}
                    type="number"
                    min={parameter.minValue}
                    max={parameter.maxValue}
                />
            );
        }

        case "String":
        default:
            return (
                <ControlsPanelSectionInput
                    label={parameter.name}
                    value={value}
                    onChange={(nextValue) => onChange(parameter.id, nextValue)}
                />
            );
    }
}

export default function CoveragePlanningControlsPanel() {
    const computation = useEnvStore((state) => state.computation);
    const envId = useEnvStore((state) => state.env.id);
    const setComputationProviderId = useEnvStore((state) => state.setComputationProviderId);
    const setComputationAlgorithmId = useEnvStore((state) => state.setComputationAlgorithmId);

    const allParameterValues = useParameterValuesStore((state) => state.parameterValues);
    const setParameterValueInStore = useParameterValuesStore((state) => state.setParameterValue);
    const setLayerVisible = useLayerSettingsStore((state) => state.setVisible);
    const headlandEnabled = useEnvStore((state) => state.env.headlandEnabled);
    const headlandWidth = useEnvStore((state) => state.env.headlandWidth);
    const setHeadlandEnabled = useEnvStore((state) => state.setHeadlandEnabled);
    const setHeadlandWidth = useEnvStore((state) => state.setHeadlandWidth);
    const [headlandWidthDraft, setHeadlandWidthDraft] = useState(headlandWidth);
    const [headlandWidthFocused, setHeadlandWidthFocused] = useState(false);

    const parameterValues = useMemo(() => {
        if (computation.selectedProviderId === null || computation.selectedAlgorithmId === null) return [];
        return allParameterValues.filter(
            (pv) => pv.algorithmId === computation.selectedAlgorithmId && pv.providerId === computation.selectedProviderId,
        );
    }, [allParameterValues, computation.selectedAlgorithmId, computation.selectedProviderId]);

    const allProviders = useComputationCatalogStore((s) => s.providers);
    const allAlgorithms = useComputationCatalogStore((s) => s.algorithms);
    const allParameters = useComputationCatalogStore((s) => s.parameters);
    const appEnums = useComputationCatalogStore((s) => s.appEnums);
    const selectedUnitOfMeasure = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const providers = allProviders;
    const algorithms = useMemo(
        () => (computation.selectedProviderId === null
            ? []
            : allAlgorithms.filter((a) => a.computationProviderId === computation.selectedProviderId)),
        [allAlgorithms, computation.selectedProviderId],
    );
    const parameters = useMemo(
        () => {
            if (computation.selectedProviderId === null || computation.selectedAlgorithmId === null) return [];
            return allParameters.filter(
                (p) => p.computationProviderId === computation.selectedProviderId
                    && p.algorithmId === computation.selectedAlgorithmId,
            );
        },
        [allParameters, computation.selectedProviderId, computation.selectedAlgorithmId],
    );

    // Validate format/type constraints against the new algorithm's params before committing the change.
    // Format is reset silently. Type changes that would update object types require confirmation.
    // Cancel leaves everything unchanged — no rollback needed.
    async function handleAlgorithmChange(value: string) {
        const newAlgorithmId = value === "" ? null : Number(value);

        if (newAlgorithmId === null) {
            setComputationAlgorithmId(null);
            return;
        }

        const { env, computation, setFormat, setType, setCoordSystem } = useEnvStore.getState();
        const providerId = computation.selectedProviderId;

        if (providerId === null) {
            setComputationAlgorithmId(newAlgorithmId);
            return;
        }

        const newParams = useComputationCatalogStore.getState().parameters.filter(
            (p) => p.algorithmId === newAlgorithmId && p.computationProviderId === providerId,
        );
        const { objects, updateObjectsType } = useCanvasObjectStore.getState();

        // ── Collect required env-field changes ────────────────────────────────
        // Nothing is applied until the user confirms. All three fields are checked
        // atomically — if any needs to change a single prompt covers all of them.

        const formatParam = newParams.find((p) => p.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_FORMAT);
        let newFormat: EnvFormat | undefined;
        if (formatParam !== undefined && formatParam.enumValues.length > 0) {
            const currentLabel = ENV_FORMAT_OPTIONS.find((opt) => opt.value === env.format)?.label;
            if (currentLabel === undefined || !formatParam.enumValues.includes(currentLabel)) {
                const resolved =
                    ENV_FORMAT_OPTIONS.find((opt) => opt.label === formatParam.defaultValue) ??
                    ENV_FORMAT_OPTIONS.find((opt) => formatParam.enumValues.includes(opt.label));
                if (resolved !== undefined) newFormat = resolved.value as EnvFormat;
            }
        }

        const typeParam = newParams.find((p) => p.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_TYPE);
        let newType: EnvType | undefined;
        if (typeParam !== undefined && typeParam.enumValues.length > 0) {
            const currentLabel = ENV_TYPE_OPTIONS.find((opt) => opt.value === env.type)?.label;
            if (currentLabel === undefined || !typeParam.enumValues.includes(currentLabel)) {
                const resolved =
                    ENV_TYPE_OPTIONS.find((opt) => opt.label === typeParam.defaultValue) ??
                    ENV_TYPE_OPTIONS.find((opt) => typeParam.enumValues.includes(opt.label));
                if (resolved !== undefined) newType = resolved.value as EnvType;
            }
        }

        const coordParam = newParams.find((p) => p.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_COORDSYSTEM);
        let newCoordSystem: CoordSystemType | undefined;
        if (coordParam !== undefined && coordParam.enumValues.length > 0) {
            if (!coordParam.enumValues.includes(env.coordSystem)) {
                const resolved = coordParam.enumValues[0] as CoordSystemType | undefined;
                if (resolved !== undefined) newCoordSystem = resolved;
            }
        }

        // Bulk-update objects only when type becomes fixed and objects mismatch.
        const nextObjectType =
            newType !== undefined && isEnvTypeFixed(newType)
                ? defaultObjectTypeForEnv(newType)
                : undefined;
        const mismatchCount =
            nextObjectType !== undefined
                ? objects.filter((obj) => obj.type !== nextObjectType).length
                : 0;

        // ── Apply or prompt ────────────────────────────────────────────────────
        const hasEnvChanges = newFormat !== undefined || newType !== undefined || newCoordSystem !== undefined;
        const requiresObjectUpdate = nextObjectType !== undefined && mismatchCount > 0;

        if (!hasEnvChanges && !requiresObjectUpdate) {
            setComputationAlgorithmId(newAlgorithmId);
            return;
        }

        const changeLines: string[] = [];
        if (newFormat !== undefined) {
            const label = ENV_FORMAT_OPTIONS.find((opt) => opt.value === newFormat)?.label ?? newFormat;
            changeLines.push(`Format → "${label}"`);
        }
        if (newType !== undefined) {
            const label = ENV_TYPE_OPTIONS.find((opt) => opt.value === newType)?.label ?? newType;
            changeLines.push(`Type → "${label}"`);
        }
        if (newCoordSystem !== undefined) {
            changeLines.push(`Coordinate System → "${newCoordSystem}"`);
        }
        if (requiresObjectUpdate) {
            const typeLabel = nextObjectType === OBJECT_TYPE.ONLINE ? "On-Line" : "Off-Line";
            changeLines.push(`${mismatchCount} object${mismatchCount !== 1 ? "s" : ""} will be updated to "${typeLabel}"`);
        }

        useConfirmationModalStore.getState().requestConfirmation({
            title: "Algorithm requires environment changes",
            message: `Switching to this algorithm requires the following changes:\n\n${changeLines.map((l) => `• ${l}`).join("\n")}\n\nContinue?`,
            tone: "warning",
            confirmLabel: "Confirm",
            cancelLabel: "Cancel",
            confirmAction: async () => {
                if (newFormat !== undefined) setFormat(newFormat);
                if (newType !== undefined) setType(newType);
                if (newCoordSystem !== undefined) setCoordSystem(newCoordSystem);
                if (nextObjectType !== undefined) updateObjectsType(nextObjectType);
                setComputationAlgorithmId(newAlgorithmId);
            },
        });
    }

    const providerOptions = useMemo(
        () => [
            { value: "", label: "" },
            ...providers
                .filter((provider): provider is typeof provider & { id: number } => provider.id !== undefined)
                .map((provider) => ({
                    value: String(provider.id),
                    label: provider.name,
                })),
        ],
        [providers],
    );

    const algorithmOptions = useMemo(
        () => [
            { value: "", label: "" },
            ...algorithms.map((algorithm) => ({
                value: String(algorithm.id),
                label: algorithm.name,
            })),
        ],
        [algorithms],
    );

    const envFormatParam = useMemo(
        () => parameters.find((p) => p.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_FORMAT),
        [parameters],
    );
    const envTypeParam = useMemo(
        () => parameters.find((p) => p.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_TYPE),
        [parameters],
    );
    const envCoordParam = useMemo(
        () => parameters.find((p) => p.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_COORDSYSTEM),
        [parameters],
    );

    const nonEnvParameters = useMemo(
        () => parameters.filter(
            (p) =>
                p.appHandler !== APP_PARAMETER_HANDLER.ENVIRONMENT_FORMAT &&
                p.appHandler !== APP_PARAMETER_HANDLER.ENVIRONMENT_TYPE &&
                p.appHandler !== APP_PARAMETER_HANDLER.ENVIRONMENT_COORDSYSTEM &&
                !SYSTEM_HEADLAND_PROVIDER_PARAM_NAMES.has(p.name),
        ),
        [parameters],
    );
    const parameterSections = useMemo(() => groupParametersBySection(nonEnvParameters), [nonEnvParameters]);

    useEffect(() => {
        if (!headlandWidthFocused) {
            setHeadlandWidthDraft(headlandWidth);
        }
    }, [headlandWidth, headlandWidthFocused]);

    const uom = unitLabel(selectedUnitOfMeasure);
    const headlandWidthLabel = uom ? `Headland Width (${uom})` : "Headland Width";

    useEffect(() => {
        const shrunkenZonesPK = { id: LAYER_ID.SHRUNKEN_ZONES, algorithmId: 0, providerId: 0 };
        const expandedObstaclesPK = { id: LAYER_ID.EXPANDED_OBSTACLES, algorithmId: 0, providerId: 0 };
        setLayerVisible(shrunkenZonesPK, headlandEnabled);
        setLayerVisible(expandedObstaclesPK, headlandEnabled);
    }, [headlandEnabled, setLayerVisible]);

    // Seed defaults for any parameter not yet written to the store.
    // ENVIRONMENT_FORMAT, ENVIRONMENT_TYPE, and ENVIRONMENT_COORDSYSTEM are skipped —
    // the always-visible Environment section handles those fields directly.
    useEffect(() => {
        if (computation.selectedAlgorithmId === null || computation.selectedProviderId === null) return;

        const { parameterValues: storedValues, setParameterValue } = useParameterValuesStore.getState();

        for (const parameter of parameters) {
            if (
                parameter.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_FORMAT ||
                parameter.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_TYPE ||
                parameter.appHandler === APP_PARAMETER_HANDLER.ENVIRONMENT_COORDSYSTEM ||
                SYSTEM_HEADLAND_PROVIDER_PARAM_NAMES.has(parameter.name)
            ) {
                continue;
            }

            const hasValue = storedValues.some(
                (pv) =>
                    pv.id === parameter.id &&
                    pv.algorithmId === parameter.algorithmId &&
                    pv.providerId === parameter.computationProviderId &&
                    pv.environmentId === envId,
            );

            if (!hasValue && parameter.defaultValue !== "") {
                setParameterValue(
                    parameter.id,
                    parameter.algorithmId,
                    parameter.computationProviderId,
                    envId,
                    parameter.defaultValue,
                );
            }
        }
    }, [parameters, envId, computation.selectedAlgorithmId, computation.selectedProviderId]);

    const algoProviderId = computation.selectedProviderId ?? undefined;
    const algoAlgorithmId = computation.selectedAlgorithmId ?? undefined;
    const selectedProviderValue = computation.selectedProviderId === null ? "" : String(computation.selectedProviderId);
    const selectedAlgorithmValue = computation.selectedAlgorithmId === null ? "" : String(computation.selectedAlgorithmId);
    const resolvedAppEnums = appEnums;

    return (
        <div>
            <ControlsPanelSection sectionId="computation-provider" title="Computation Provider">
                <ControlsPanelSectionSelect
                    label="Provider"
                    value={selectedProviderValue}
                    onChange={(value) => setComputationProviderId(value === "" ? null : Number(value))}
                    options={providerOptions}
                    disabled={providers.length === 0}
                />

                <ControlsPanelSectionSelect
                    label="Algorithm"
                    value={selectedAlgorithmValue}
                    onChange={(value) => { handleAlgorithmChange(value).catch(console.error); }}
                    options={algorithmOptions}
                    disabled={computation.selectedProviderId === null || algorithms.length === 0}
                />
            </ControlsPanelSection>

            <ControlsPanelSeparator />

            <ControlsPanelSection sectionId="environment" title="Environment">
                <FormatSelection
                    providerId={envFormatParam !== undefined ? algoProviderId : undefined}
                    algorithmId={envFormatParam !== undefined ? algoAlgorithmId : undefined}
                    parameterId={envFormatParam?.id}
                    parameterName={envFormatParam?.name}
                    enumValues={envFormatParam?.enumValues}
                />
                <EnvTypeSelection
                    providerId={envTypeParam !== undefined ? algoProviderId : undefined}
                    algorithmId={envTypeParam !== undefined ? algoAlgorithmId : undefined}
                    parameterId={envTypeParam?.id}
                    parameterName={envTypeParam?.name}
                    enumValues={envTypeParam?.enumValues}
                />
                <CoordinateSystemSelect
                    providerId={envCoordParam !== undefined ? algoProviderId : undefined}
                    algorithmId={envCoordParam !== undefined ? algoAlgorithmId : undefined}
                    parameterId={envCoordParam?.id}
                    parameterName={envCoordParam?.name}
                    enumValues={envCoordParam?.enumValues}
                />
            </ControlsPanelSection>

            <ControlsPanelSeparator />

            <ControlsPanelSection sectionId="headland-system" title="Headland">
                <ControlsPanelSectionCheckbox
                    label="Headland"
                    checked={headlandEnabled}
                    onChange={setHeadlandEnabled}
                />
                {headlandEnabled && (
                    <ControlsPanelSectionInput
                        label={headlandWidthLabel}
                        value={headlandWidthDraft}
                        onChange={setHeadlandWidthDraft}
                        onFocus={() => setHeadlandWidthFocused(true)}
                        onBlur={() => {
                            setHeadlandWidthFocused(false);
                            const parsed = parseHeadlandWidth(headlandWidthDraft);
                            if (parsed === null) {
                                setHeadlandWidth("");
                                return;
                            }
                            setHeadlandWidth(String(parsed));
                        }}
                        type="number"
                        min={0}
                    />
                )}
            </ControlsPanelSection>

            {parameterSections.length > 0 && (
                <>
                    <ControlsPanelSeparator />
                    {parameterSections.map((section) => (
                        <ControlsPanelSection
                            key={section.title}
                            sectionId={`parameter-section:${section.title}`}
                            title={section.title}
                        >
                            {section.parameters.map((parameter) => (
                                <DynamicParameterField
                                    key={`${parameter.algorithmId}:${parameter.id}:${parameter.name}`}
                                    parameter={parameter}
                                    selectedProviderId={computation.selectedProviderId!}
                                    selectedAlgorithmId={computation.selectedAlgorithmId!}
                                    parameterValues={parameterValues}
                                    appEnums={resolvedAppEnums}
                                    unitOfMeasure={selectedUnitOfMeasure}
                                    onChange={(parameterId, value) => {
                                        setParameterValueInStore(
                                            parameterId,
                                            computation.selectedAlgorithmId!,
                                            computation.selectedProviderId!,
                                            envId,
                                            value,
                                        );
                                    }}
                                />
                            ))}
                        </ControlsPanelSection>
                    ))}
                </>
            )}
        </div>
    );
}