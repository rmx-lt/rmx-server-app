import { useState } from "react";
import InternalCardModalFastTab from "@/components/modals/card-modal/internal/InternalCardModalFastTab";
import CardModalField from "@/components/modals/card-modal/CardModalField";
import {
    type BenchmarkJobSetup,
    type BenchmarkJobAlgorithm,
    type BenchmarkJobType,
    type BenchmarkMetricsConfig,
    type BenchmarkMetricType,
} from "@/features/benchmark-manager/stores/benchmarkModalStore";
import type { ComputationAlgorithm, ComputationProvider } from "@/data/local/serviceTypes";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEmptySlot(): BenchmarkJobAlgorithm {
    return {
        providerId: null,
        algorithmId: null,
        multipleRunsSetup: { runsPerEnvironment: 1, runsPerStep: 1, stepValueCalculation: "median" },
        targetParameterSetup: null,
        fixedParameters: [],
    };
}

function resizeAlgorithms(current: BenchmarkJobAlgorithm[], count: number): BenchmarkJobAlgorithm[] {
    if (count <= current.length) return current.slice(0, count);
    return [...current, ...Array.from({ length: count - current.length }, makeEmptySlot)];
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface BenchmarkJobSetupTabProps {
    providers: ComputationProvider[];
    allAlgorithms: ComputationAlgorithm[];
    jobSetup: BenchmarkJobSetup;
    onSetJobSetup: (setup: Partial<BenchmarkJobSetup>) => void;
    onSetJobAlgorithm: (index: number, update: Partial<BenchmarkJobAlgorithm>) => void;
    metricsConfig: BenchmarkMetricsConfig;
    onToggleMetric: (metric: BenchmarkMetricType) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BenchmarkJobSetupTab({
    providers,
    allAlgorithms,
    jobSetup,
    onSetJobSetup,
    onSetJobAlgorithm,
    metricsConfig,
    onToggleMetric,
}: BenchmarkJobSetupTabProps) {
    const [jobExpanded, setJobExpanded] = useState(true);
    const [algorithmsExpanded, setAlgorithmsExpanded] = useState(true);
    const [metricsExpanded, setMetricsExpanded] = useState(true);

    const algorithmsDisabled = jobSetup.type === "";

    // ── Handlers ──────────────────────────────────────────────────────────────

    function handleTypeChange(raw: string) {
        const type = raw as BenchmarkJobType;

        if (type === "") {
            onSetJobSetup({ type: "", algorithmsCount: 1, algorithms: [] });
            return;
        }

        const count = type === "parameter-eval" ? 1 : jobSetup.algorithmsCount || 1;
        const algorithms = resizeAlgorithms(jobSetup.algorithms, count);
        onSetJobSetup({ type, algorithmsCount: count, algorithms });
    }

    function handleCountChange(raw: string) {
        const count = Math.max(1, Number(raw) || 1);
        const algorithms = resizeAlgorithms(jobSetup.algorithms, count);
        onSetJobSetup({ algorithmsCount: count, algorithms });
    }

    function handleProviderChange(index: number, raw: string) {
        const providerId = raw ? Number(raw) : null;
        onSetJobAlgorithm(index, { providerId, algorithmId: null });
    }

    function handleAlgorithmChange(index: number, raw: string) {
        const algorithmId = raw ? Number(raw) : null;
        onSetJobAlgorithm(index, { algorithmId });
    }

    // ── Derived values ────────────────────────────────────────────────────────

    const countValue =
        jobSetup.type === "" ? "" :
        String(jobSetup.algorithmsCount);

    const countDisabled = jobSetup.type !== "algorithm-eval";

    return (
        <div className="p-4 flex flex-col gap-4">
            {/* Job */}
            <InternalCardModalFastTab
                title="Job"
                expanded={jobExpanded}
                onToggle={() => setJobExpanded((x) => !x)}
            >
                <CardModalField
                    id="job-type"
                    label="Type"
                    type="select"
                    value={jobSetup.type}
                    options={[
                        { value: "", label: "" },
                        { value: "parameter-eval", label: "Parameter Eval." },
                        { value: "algorithm-eval", label: "Algorithm Eval." },
                    ]}
                    onChange={handleTypeChange}
                />
                <CardModalField
                    id="job-algorithms-count"
                    label="Algorithms Count"
                    type="number"
                    disabled={countDisabled}
                    value={countValue}
                    min={1}
                    onChange={handleCountChange}
                />
            </InternalCardModalFastTab>

            {/* Algorithms */}
            <InternalCardModalFastTab
                title="Algorithms"
                expanded={algorithmsDisabled ? false : algorithmsExpanded}
                onToggle={algorithmsDisabled ? () => {} : () => setAlgorithmsExpanded((x) => !x)}
                disabled={algorithmsDisabled}
            >
                {jobSetup.algorithms.map((slot, i) => {
                    const slotAlgorithms = slot.providerId !== null
                        ? allAlgorithms.filter((a) => a.computationProviderId === slot.providerId)
                        : [];

                    return (
                        <div key={i} className="contents">
                            <CardModalField
                                id={`job-provider-${i}`}
                                label={`#${i + 1} Provider`}
                                type="select"
                                value={slot.providerId !== null ? String(slot.providerId) : ""}
                                options={[
                                    { value: "", label: "" },
                                    ...providers.map((p) => ({ value: String(p.id), label: p.name })),
                                ]}
                                onChange={(v) => handleProviderChange(i, v)}
                            />
                            <CardModalField
                                id={`job-algorithm-${i}`}
                                label={`#${i + 1} Algorithm`}
                                type="select"
                                disabled={slot.providerId === null}
                                value={slot.algorithmId !== null ? String(slot.algorithmId) : ""}
                                options={[
                                    { value: "", label: "" },
                                    ...slotAlgorithms.map((a) => ({ value: String(a.id), label: a.name })),
                                ]}
                                onChange={(v) => handleAlgorithmChange(i, v)}
                            />
                        </div>
                    );
                })}
            </InternalCardModalFastTab>

            {/* Metrics */}
            <InternalCardModalFastTab
                title="Metrics"
                expanded={metricsExpanded}
                onToggle={() => setMetricsExpanded((x) => !x)}
            >
                <CardModalField id="job-metric-coverage" label="Coverage Ratio" type="checkbox" checked={metricsConfig.selectedMetrics.has("coverage")} onChange={() => onToggleMetric("coverage")} />
                <CardModalField id="job-metric-overlap" label="Overlap Ratio" type="checkbox" checked={metricsConfig.selectedMetrics.has("overlap")} onChange={() => onToggleMetric("overlap")} />
                <CardModalField id="job-metric-efficiency" label="Efficiency" type="checkbox" checked={metricsConfig.selectedMetrics.has("efficiency")} onChange={() => onToggleMetric("efficiency")} />
                <CardModalField id="job-metric-turns" label="Number of Turns" type="checkbox" checked={metricsConfig.selectedMetrics.has("turns")} onChange={() => onToggleMetric("turns")} />
                <CardModalField id="job-metric-path-length" label="Path Length" type="checkbox" checked={metricsConfig.selectedMetrics.has("pathLength")} onChange={() => onToggleMetric("pathLength")} />
            </InternalCardModalFastTab>
        </div>
    );
}
