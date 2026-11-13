import { useMemo, useState } from "react";
import InternalCardModalFastTab from "@/components/modals/card-modal/internal/InternalCardModalFastTab";
import CardModalField from "@/components/modals/card-modal/CardModalField";
import { APP_PARAMETER_HANDLER } from "@/config/computation/appParameterHandlers";
import { SYSTEM_HEADLAND_PROVIDER_PARAM_NAMES } from "@/features/coverage-planning/utils/headlandGeometry";
import {
    type BenchmarkJobAlgorithm,
    type BenchmarkJobType,
    type BenchmarkParameterSetup,
} from "@/features/benchmark-manager/stores/benchmarkModalStore";
import type { AlgorithmParameter, ComputationAlgorithm, ComputationProvider } from "@/data/local/serviceTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_ENV_HANDLERS: ReadonlySet<string> = new Set([
    APP_PARAMETER_HANDLER.ENVIRONMENT_FORMAT,
    APP_PARAMETER_HANDLER.ENVIRONMENT_TYPE,
    APP_PARAMETER_HANDLER.ENVIRONMENT_COORDSYSTEM,
]);

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BenchmarkAlgoSetupTabProps {
    index: number;
    slot: BenchmarkJobAlgorithm;
    jobType: BenchmarkJobType;
    providers: ComputationProvider[];
    allAlgorithms: ComputationAlgorithm[];
    catalogParameters: AlgorithmParameter[];
    onSetSlot: (update: Partial<BenchmarkJobAlgorithm>) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BenchmarkAlgoSetupTab({
    slot,
    jobType,
    providers,
    allAlgorithms,
    catalogParameters,
    onSetSlot,
}: BenchmarkAlgoSetupTabProps) {
    const [providerExpanded, setProviderExpanded] = useState(true);
    const [multipleRunsExpanded, setMultipleRunsExpanded] = useState(false);
    const [targetParamExpanded, setTargetParamExpanded] = useState(true);
    const [parametersExpanded, setParametersExpanded] = useState(true);

    const provider = useMemo(
        () => providers.find((p) => p.id === slot.providerId),
        [providers, slot.providerId],
    );

    const algorithm = useMemo(
        () => allAlgorithms.find((a) => a.id === slot.algorithmId),
        [allAlgorithms, slot.algorithmId],
    );

    const algorithmParams = useMemo(
        () =>
            slot.algorithmId && slot.providerId
                ? catalogParameters.filter(
                    (p) => p.algorithmId === slot.algorithmId && p.computationProviderId === slot.providerId,
                )
                : [],
        [catalogParameters, slot.algorithmId, slot.providerId],
    );

    const numericParameters = useMemo(
        () => algorithmParams.filter((p) => p.paramType === "Integer" || p.paramType === "Decimal"),
        [algorithmParams],
    );

    const nonTargetParameters = useMemo(
        () =>
            algorithmParams.filter(
                (p) =>
                    p.id !== slot.targetParameterSetup?.targetParamId &&
                    !SYSTEM_ENV_HANDLERS.has(p.appHandler ?? "") &&
                    !SYSTEM_HEADLAND_PROVIDER_PARAM_NAMES.has(p.name),
            ),
        [algorithmParams, slot.targetParameterSetup],
    );

    const targetParam = useMemo(
        () => numericParameters.find((p) => p.id === slot.targetParameterSetup?.targetParamId),
        [numericParameters, slot.targetParameterSetup],
    );

    const targetParamDisabled = numericParameters.length === 0;
    const parametersDisabled = nonTargetParameters.length === 0;
    const isParameterEval = jobType === "parameter-eval";

    function setFixedParam(paramId: number, value: string) {
        const existing = slot.fixedParameters.find((fp) => fp.paramId === paramId);
        const updated = existing
            ? slot.fixedParameters.map((fp) => (fp.paramId === paramId ? { ...fp, value } : fp))
            : [...slot.fixedParameters, { paramId, value }];
        onSetSlot({ fixedParameters: updated });
    }

    function setTargetParam(setup: BenchmarkParameterSetup | null) {
        onSetSlot({ targetParameterSetup: setup });
    }

    return (
        <div className="p-4 flex flex-col gap-4">
            {/* Provider */}
            <InternalCardModalFastTab
                title="Provider"
                expanded={providerExpanded}
                onToggle={() => setProviderExpanded((x) => !x)}
            >
                <CardModalField
                    id={`algo-provider-${slot.providerId}`}
                    label="Provider"
                    type="text"
                    disabled
                    value={provider?.name ?? ""}
                    onChange={() => {}}
                />
                <CardModalField
                    id={`algo-algorithm-${slot.algorithmId}`}
                    label="Algorithm"
                    type="text"
                    disabled
                    value={algorithm?.name ?? ""}
                    onChange={() => {}}
                />
            </InternalCardModalFastTab>

            {/* Multiple Runs */}
            <InternalCardModalFastTab
                title="Multiple Runs"
                expanded={multipleRunsExpanded}
                onToggle={() => setMultipleRunsExpanded((x) => !x)}
            >
                <CardModalField
                    id={`algo-runs-per-env-${slot.algorithmId}`}
                    label="Runs per Environment"
                    type="number"
                    value={String(slot.multipleRunsSetup.runsPerEnvironment)}
                    onChange={(v) => {
                        const n = Math.max(1, Math.floor(Number(v)));
                        if (Number.isFinite(n)) {
                            onSetSlot({
                                multipleRunsSetup: {
                                    ...slot.multipleRunsSetup,
                                    runsPerEnvironment: n,
                                },
                            });
                        }
                    }}
                />
                <CardModalField
                    id={`algo-aggregate-method-${slot.algorithmId}`}
                    label="Aggregate Method"
                    type="select"
                    value={slot.multipleRunsSetup.stepValueCalculation}
                    options={[
                        { value: "median", label: "Median" },
                        { value: "average", label: "Average" },
                    ]}
                    onChange={(v) =>
                        onSetSlot({
                            multipleRunsSetup: {
                                ...slot.multipleRunsSetup,
                                stepValueCalculation: v as "median" | "average",
                            },
                        })
                    }
                />
            </InternalCardModalFastTab>

            {/* Target Parameter — only for parameter-eval */}
            {isParameterEval && (
                <InternalCardModalFastTab
                    title="Target Parameter"
                    expanded={targetParamDisabled ? false : targetParamExpanded}
                    onToggle={targetParamDisabled ? () => {} : () => setTargetParamExpanded((x) => !x)}
                    disabled={targetParamDisabled}
                >
                    <CardModalField
                        id={`algo-target-param-${slot.algorithmId}`}
                        label="Parameter"
                        type="select"
                        value={
                            slot.targetParameterSetup?.targetParamId !== undefined
                                ? String(slot.targetParameterSetup.targetParamId)
                                : ""
                        }
                        options={[
                            { value: "", label: "" },
                            ...numericParameters.map((p) => ({ value: String(p.id), label: p.name })),
                        ]}
                        onChange={(v) => {
                            if (!v) { setTargetParam(null); return; }
                            const paramId = Number(v);
                            const param = numericParameters.find((p) => p.id === paramId);
                            if (param) {
                                setTargetParam({
                                    targetParamId: paramId,
                                    startValue: param.defaultValue || param.minValue?.toString() || "0",
                                    endValue: param.maxValue?.toString() || "100",
                                    stepValue: "1",
                                });
                            }
                        }}
                    />
                    <CardModalField
                        id={`algo-target-start-${slot.algorithmId}`}
                        label="Start"
                        unitType={targetParam?.unitType}
                        type="number"
                        disabled={!slot.targetParameterSetup}
                        value={slot.targetParameterSetup?.startValue ?? ""}
                        onChange={(v) =>
                            slot.targetParameterSetup &&
                            setTargetParam({ ...slot.targetParameterSetup, startValue: v })
                        }
                    />
                    <CardModalField
                        id={`algo-target-end-${slot.algorithmId}`}
                        label="End"
                        unitType={targetParam?.unitType}
                        type="number"
                        disabled={!slot.targetParameterSetup}
                        value={slot.targetParameterSetup?.endValue ?? ""}
                        onChange={(v) =>
                            slot.targetParameterSetup &&
                            setTargetParam({ ...slot.targetParameterSetup, endValue: v })
                        }
                    />
                    <CardModalField
                        id={`algo-target-step-${slot.algorithmId}`}
                        label="Step"
                        unitType={targetParam?.unitType}
                        type="number"
                        disabled={!slot.targetParameterSetup}
                        value={slot.targetParameterSetup?.stepValue ?? ""}
                        onChange={(v) =>
                            slot.targetParameterSetup &&
                            setTargetParam({ ...slot.targetParameterSetup, stepValue: v })
                        }
                    />
                </InternalCardModalFastTab>
            )}

            {/* Parameters */}
            <InternalCardModalFastTab
                title="Parameters"
                expanded={parametersDisabled ? false : parametersExpanded}
                onToggle={parametersDisabled ? () => {} : () => setParametersExpanded((x) => !x)}
                disabled={parametersDisabled}
            >
                {nonTargetParameters.map((param) => {
                    const fixedValue = slot.fixedParameters.find((fp) => fp.paramId === param.id);
                    const rawValue = fixedValue?.value ?? param.defaultValue ?? "";

                    if (param.paramType === "Enum") {
                        return (
                            <CardModalField
                                key={param.id}
                                id={`algo-fixed-${slot.algorithmId}-${param.id}`}
                                label={param.name}
                                type="select"
                                value={rawValue || (param.enumValues[0] ?? "")}
                                options={param.enumValues.map((v) => ({ value: v, label: v }))}
                                onChange={(v: string) => setFixedParam(param.id, v)}
                            />
                        );
                    }

                    if (param.paramType === "Boolean") {
                        return (
                            <CardModalField
                                key={param.id}
                                id={`algo-fixed-${slot.algorithmId}-${param.id}`}
                                label={param.name}
                                type="checkbox"
                                checked={rawValue === "true"}
                                onChange={(v) => setFixedParam(param.id, String(v))}
                            />
                        );
                    }

                    return (
                        <CardModalField
                            key={param.id}
                            id={`algo-fixed-${slot.algorithmId}-${param.id}`}
                            label={param.name}
                            unitType={param.unitType}
                            type={param.paramType as "Integer" | "Decimal" | "String"}
                            value={rawValue}
                            min={param.minValue}
                            max={param.maxValue}
                            placeholder={param.defaultValue || ""}
                            onChange={(v: string) => setFixedParam(param.id, v)}
                        />
                    );
                })}
            </InternalCardModalFastTab>
        </div>
    );
}
