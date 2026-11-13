import { useCallback, useMemo } from "react";
import ChartCard, { type ChartSeries } from "@/components/chart/ChartCard";
import {
    type BenchmarkAlgoResult,
    type BenchmarkEnvironmentSetSetup,
    type BenchmarkEnvironmentSetup,
    type BenchmarkExecutionState,
    type BenchmarkExecutionStatus,
    type BenchmarkJobType,
    type BenchmarkMetricType,
    type BenchmarkParameterSetup,
    type BenchmarkStepValueCalculation,
    type BenchmarkSystemEnvironmentSetup,
} from "@/features/benchmark-manager/stores/benchmarkModalStore";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BenchmarkRunTabProps {
    jobType: BenchmarkJobType;
    providerName: string;
    algorithmName: string;
    jobAlgorithms: Array<{ providerName: string; algorithmName: string }>;
    targetParameterName: string;
    targetParameterSetup: BenchmarkParameterSetup | null;
    stepValueCalculation: BenchmarkStepValueCalculation;
    environmentSetup: BenchmarkEnvironmentSetup;
    environmentSetSetup: BenchmarkEnvironmentSetSetup;
    systemEnvironmentSetup: BenchmarkSystemEnvironmentSetup;
    metricsConfig: { selectedMetrics: Set<BenchmarkMetricType> };
    isRunning: boolean;
    error: string | null;
    executionState: BenchmarkExecutionState;
    onStartBenchmark: () => void;
    onCancelBenchmark: () => void;
    canStartBenchmark: boolean;
    systemParamsError: string | null;
    algoResults: BenchmarkAlgoResult[];
    /** Names of algorithm metrics flagged benchmark=true, grouped across all slots */
    benchmarkPerfMetricNames: string[];
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function downloadCsv(filename: string, rows: string[][]): void {
    const content = rows
        .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
        .join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BenchmarkExecutionStatus, { label: string; className: string }> = {
    idle: { label: "IDLE", className: "bg-gray-100 text-gray-600" },
    running: { label: "RUNNING", className: "bg-blue-100 text-blue-700" },
    completed: { label: "COMPLETED", className: "bg-teal-100 text-teal-700" },
    cancelled: { label: "CANCELLED", className: "bg-amber-100 text-amber-700" },
    error: { label: "ERROR", className: "bg-red-100 text-red-700" },
};

const METRIC_LABELS: Record<BenchmarkMetricType, string> = {
    coverage: "Coverage Ratio",
    overlap: "Overlap Ratio",
    efficiency: "Efficiency",
    turns: "Number of Turns",
    pathLength: "Path Length",
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function BenchmarkRunTab({
    jobType,
    providerName,
    algorithmName,
    jobAlgorithms,
    targetParameterName,
    targetParameterSetup,
    stepValueCalculation,
    environmentSetup,
    environmentSetSetup,
    metricsConfig,
    isRunning,
    error,
    executionState,
    onStartBenchmark,
    onCancelBenchmark,
    canStartBenchmark,
    systemParamsError,
    algoResults,
    benchmarkPerfMetricNames,
}: BenchmarkRunTabProps) {
    const selectedMetrics = useMemo(() => Array.from(metricsConfig.selectedMetrics), [metricsConfig.selectedMetrics]);

    const chartSeries = useMemo(() => {
        const sorted = [...executionState.results].sort((a, b) => a.stepValue - b.stepValue);
        return selectedMetrics.map((metric, idx) => ({
            metric,
            metricId: 10000 + idx,
            name: `${METRIC_LABELS[metric]} vs ${targetParameterName}`,
            series: [{
                label: METRIC_LABELS[metric],
                data: sorted.map((result) => ({
                    x: result.stepValue,
                    y: result.aggregatedMetrics[metric][stepValueCalculation] ?? Number.NaN,
                })),
            }] as ChartSeries[],
        }));
    }, [executionState.results, selectedMetrics, stepValueCalculation, targetParameterName]);

    const algoChartSeries = useMemo(() => {
        if (algoResults.length === 0) return [];
        return selectedMetrics.map((metric, idx) => ({
            metric,
            metricId: 20000 + idx,
            name: METRIC_LABELS[metric],
            series: algoResults.map((algoResult) => ({
                label: jobAlgorithms[algoResult.algoIndex]?.algorithmName || `#${algoResult.algoIndex + 1}`,
                data: algoResult.envResults.map((envResult) => ({
                    x: envResult.envIndex + 1,
                    y: envResult.metrics[metric] ?? Number.NaN,
                })),
            })) as ChartSeries[],
        }));
    }, [algoResults, selectedMetrics, jobAlgorithms]);

    // ── Performance metric charts ─────────────────────────────────────────
    const perfChartSeries = useMemo(() => {
        const sorted = [...executionState.results].sort((a, b) => a.stepValue - b.stepValue);
        return benchmarkPerfMetricNames.map((name, idx) => ({
            name,
            metricId: 30000 + idx,
            chartName: `${name} vs ${targetParameterName}`,
            series: [{
                label: name,
                data: sorted.map((result) => ({
                    x: result.stepValue,
                    y: result.aggregatedMetrics.performance[name]?.[stepValueCalculation] ?? Number.NaN,
                })),
            }] as ChartSeries[],
        }));
    }, [executionState.results, benchmarkPerfMetricNames, stepValueCalculation, targetParameterName]);

    const algoPerfChartSeries = useMemo(() => {
        if (algoResults.length === 0) return [];
        return benchmarkPerfMetricNames.map((name, idx) => ({
            name,
            metricId: 40000 + idx,
            series: algoResults.map((algoResult) => ({
                label: jobAlgorithms[algoResult.algoIndex]?.algorithmName || `#${algoResult.algoIndex + 1}`,
                data: algoResult.envResults.map((envResult) => ({
                    x: envResult.envIndex + 1,
                    y: envResult.metrics.performance[name] ?? Number.NaN,
                })),
            })) as ChartSeries[],
        }));
    }, [algoResults, benchmarkPerfMetricNames, jobAlgorithms]);

    const handleExportCsv = useCallback(() => {
        if (jobType === "algorithm-eval") {
            const headers = ["Algorithm", "Env", "Runs OK", "Runs Failed", ...selectedMetrics.map((m) => METRIC_LABELS[m]), ...benchmarkPerfMetricNames];
            const rows = algoResults.flatMap((algoResult) =>
                algoResult.envResults.map((envResult) => [
                    `#${algoResult.algoIndex + 1}`,
                    `#${envResult.envIndex + 1}`,
                    String(envResult.runsCompleted),
                    String(envResult.runsFailed),
                    ...selectedMetrics.map((metric) => {
                        const v = envResult.metrics[metric];
                        return v === null ? "" : String(v);
                    }),
                    ...benchmarkPerfMetricNames.map((name) => {
                        const v = envResult.metrics.performance[name];
                        return v === null || v === undefined ? "" : String(v);
                    }),
                ])
            );
            downloadCsv("benchmark-algo-eval.csv", [headers, ...rows]);
        } else {
            const headers = [targetParameterName, "Runs OK", "Runs Failed", ...selectedMetrics.map((m) => METRIC_LABELS[m]), ...benchmarkPerfMetricNames];
            const rows = executionState.results.map((stepResult) => [
                String(stepResult.stepValue),
                String(stepResult.runsCompleted),
                String(stepResult.runsFailed),
                ...selectedMetrics.map((metric) => {
                    const v = stepResult.aggregatedMetrics[metric][stepValueCalculation];
                    return typeof v === "number" ? String(v) : "";
                }),
                ...benchmarkPerfMetricNames.map((name) => {
                    const v = stepResult.aggregatedMetrics.performance[name]?.[stepValueCalculation];
                    return typeof v === "number" ? String(v) : "";
                }),
            ]);
            downloadCsv(`benchmark-param-eval-${targetParameterName}.csv`, [headers, ...rows]);
        }
    }, [jobType, algoResults, executionState.results, selectedMetrics, stepValueCalculation, targetParameterName, benchmarkPerfMetricNames]);

    const { progress, status } = executionState;
    const statusInfo = STATUS_CONFIG[status];
    const progressPct = progress.totalRuns > 0 ? (progress.completedRuns / progress.totalRuns) * 100 : 0;

    return (
        <div className="p-4 flex flex-col gap-4">

            {/* ── A. Controls bar ───────────────────────────────────────── */}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onStartBenchmark}
                    disabled={isRunning || !canStartBenchmark}
                    className={`px-4 py-1.5 rounded text-sm font-medium text-white transition-colors ${isRunning || !canStartBenchmark
                        ? "bg-gray-300 cursor-not-allowed text-gray-500"
                        : "bg-teal-600 hover:bg-teal-700 active:bg-teal-800"
                        }`}
                >
                    Start Benchmark
                </button>
                <button
                    type="button"
                    onClick={onCancelBenchmark}
                    disabled={!isRunning}
                    className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${!isRunning
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200"
                        }`}
                >
                    Cancel
                </button>
                <span className={`ml-auto px-2.5 py-0.5 rounded text-xs font-semibold tracking-wider ${statusInfo.className}`}>
                    {statusInfo.label}
                </span>
            </div>

            {/* ── B. Job Summary card ───────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Algorithm</p>
                    {jobType === "algorithm-eval" ? (
                        <div className="flex flex-col gap-0.5">
                            {jobAlgorithms.length > 0 ? jobAlgorithms.map((algo, idx) => (
                                <p key={idx} className="text-sm font-medium text-gray-800">
                                    #{idx + 1} — {algo.providerName || <span className="italic text-gray-400">not selected</span>} / {algo.algorithmName || <span className="italic text-gray-400">not selected</span>}
                                </p>
                            )) : (
                                <p className="text-sm italic text-gray-400">No algorithms configured</p>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm font-medium text-gray-800">
                            #1 — {providerName || <span className="italic text-gray-400">not selected</span>} / {algorithmName || <span className="italic text-gray-400">not selected</span>}
                        </p>
                    )}
                </div>
                <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Environments</p>
                    <p className="text-sm text-gray-700">
                        {environmentSetSetup.count} × {environmentSetup.width}×{environmentSetup.height} @ {environmentSetup.cellSize}
                    </p>
                </div>
                {targetParameterSetup && (
                    <>
                        <div>
                            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5 mt-1.5">Varying</p>
                            <p className="text-sm text-gray-700">
                                {targetParameterName}: {targetParameterSetup.startValue} → {targetParameterSetup.endValue}, step {targetParameterSetup.stepValue}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5 mt-1.5">Aggregate</p>
                            <p className="text-sm text-gray-700 capitalize">{stepValueCalculation}</p>
                        </div>
                    </>
                )}
            </div>

            {/* ── C. Progress ───────────────────────────────────────────── */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                        Steps: <strong className="text-slate-800">{progress.completedSteps}</strong>/{progress.totalSteps}
                        {" · "}
                        Runs: <strong className="text-slate-800">{progress.completedRuns}</strong>/{progress.totalRuns}
                    </span>
                    {isRunning && typeof progress.currentStepValue === "number" && (
                        <span className="text-blue-600">
                            Testing {targetParameterName} = <strong>{progress.currentStepValue}</strong>
                        </span>
                    )}
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-teal-500 transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
            </div>

            {/* ── D. Banners ────────────────────────────────────────────── */}
            {systemParamsError && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs font-semibold text-amber-900 mb-0.5">Generator Compatibility</p>
                    <p className="text-xs text-amber-800">{systemParamsError}</p>
                </div>
            )}
            {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs font-semibold text-red-900 mb-0.5">Error</p>
                    <p className="text-xs text-red-700">{error}</p>
                </div>
            )}

            {/* ── E. Results ────────────────────────────────────────────── */}
            {jobType === "algorithm-eval" ? (
                <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Results</span>
                        <span
                            onClick={algoResults.length === 0 ? undefined : handleExportCsv}
                            title="Export CSV"
                            className={`material-symbols-outlined cursor-pointer select-none leading-none ${algoResults.length === 0 ? "text-gray-200 pointer-events-none" : "text-gray-300 hover:text-gray-600"}`}
                            style={{ fontSize: 16 }}
                        >
                            table_chart
                        </span>
                    </div>
                    {algoResults.length === 0 ? (
                        <div className="text-center text-sm text-gray-400 py-8">
                            Results will appear here once algorithms complete
                        </div>
                    ) : (
                        <div className="max-h-64 overflow-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50 text-gray-600 sticky top-0">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">Algorithm</th>
                                        <th className="px-3 py-2 text-left font-medium">Env</th>
                                        <th className="px-3 py-2 text-left font-medium">Runs</th>
                                        {selectedMetrics.map((metric) => (
                                            <th key={metric} className="px-3 py-2 text-left font-medium">{METRIC_LABELS[metric]}</th>
                                        ))}
                                        {benchmarkPerfMetricNames.map((name) => (
                                            <th key={`perf-${name}`} className="px-3 py-2 text-left font-medium text-violet-700">{name}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {algoResults.flatMap((algoResult) =>
                                        algoResult.envResults.map((envResult) => (
                                            <tr key={`${algoResult.algoIndex}-${envResult.envIndex}`} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-3 py-2 font-medium text-gray-800">#{algoResult.algoIndex + 1}</td>
                                                <td className="px-3 py-2 font-medium text-gray-800">#{envResult.envIndex + 1}</td>
                                                <td className="px-3 py-2 text-gray-500">
                                                    <span className="text-teal-700">{envResult.runsCompleted} ok</span>
                                                    {envResult.runsFailed > 0 && (
                                                        <span className="text-red-600"> / {envResult.runsFailed} failed</span>
                                                    )}
                                                </td>
                                                {selectedMetrics.map((metric) => {
                                                    const value = envResult.metrics[metric];
                                                    return (
                                                        <td key={metric} className="px-3 py-2 tabular-nums text-gray-700">
                                                            {typeof value === "number" ? String(parseFloat(value.toFixed(2))) : "—"}
                                                        </td>
                                                    );
                                                })}
                                                {benchmarkPerfMetricNames.map((name) => {
                                                    const value = envResult.metrics.performance[name];
                                                    return (
                                                        <td key={`perf-${name}`} className="px-3 py-2 tabular-nums text-violet-700">
                                                            {typeof value === "number" ? String(parseFloat(value.toFixed(2))) : "—"}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            ) : (
                /* ── E. Parameter-eval Results table ─────────────────── */
                <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Results</span>
                        <span
                            onClick={executionState.results.length === 0 ? undefined : handleExportCsv}
                            title="Export CSV"
                            className={`material-symbols-outlined cursor-pointer select-none leading-none ${executionState.results.length === 0 ? "text-gray-200 pointer-events-none" : "text-gray-300 hover:text-gray-600"}`}
                            style={{ fontSize: 16 }}
                        >
                            table_chart
                        </span>
                    </div>
                    {executionState.results.length === 0 ? (
                        <div className="text-center text-sm text-gray-400 py-8">
                            Results will appear here once steps complete
                        </div>
                    ) : (
                        <div className="max-h-64 overflow-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50 text-gray-600 sticky top-0">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">{targetParameterName}</th>
                                        <th className="px-3 py-2 text-left font-medium">Runs</th>
                                        {selectedMetrics.map((metric) => (
                                            <th key={metric} className="px-3 py-2 text-left font-medium">{METRIC_LABELS[metric]}</th>
                                        ))}
                                        {benchmarkPerfMetricNames.map((name) => (
                                            <th key={`perf-${name}`} className="px-3 py-2 text-left font-medium text-violet-700">{name}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {executionState.results.map((stepResult) => (
                                        <tr key={stepResult.stepValue} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-3 py-2 font-mono font-medium text-gray-800">{stepResult.stepValue}</td>
                                            <td className="px-3 py-2 text-gray-500">
                                                <span className="text-teal-700">{stepResult.runsCompleted} ok</span>
                                                {stepResult.runsFailed > 0 && (
                                                    <span className="text-red-600"> / {stepResult.runsFailed} failed</span>
                                                )}
                                            </td>
                                            {selectedMetrics.map((metric) => {
                                                const aggregate = stepResult.aggregatedMetrics[metric][stepValueCalculation];
                                                return (
                                                    <td key={metric} className="px-3 py-2 tabular-nums text-gray-700">
                                                        {typeof aggregate === "number" ? String(parseFloat(aggregate.toFixed(2))) : "—"}
                                                    </td>
                                                );
                                            })}
                                            {benchmarkPerfMetricNames.map((name) => {
                                                const aggregate = stepResult.aggregatedMetrics.performance[name]?.[stepValueCalculation];
                                                return (
                                                    <td key={`perf-${name}`} className="px-3 py-2 tabular-nums text-violet-700">
                                                        {typeof aggregate === "number" ? String(parseFloat(aggregate.toFixed(2))) : "—"}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── F. Charts ─────────────────────────────────────────────── */}
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Trend Charts
                </div>
                {jobType === "algorithm-eval" ? (
                    algoChartSeries.length === 0 && algoPerfChartSeries.length === 0 ? (
                        <div className="text-center text-sm text-gray-400 py-8">
                            Complete at least one algorithm to render charts
                        </div>
                    ) : (
                        <div className="p-3 flex flex-col gap-3 max-h-112 overflow-y-auto">
                            {algoChartSeries.map((chart) => (
                                <ChartCard
                                    key={chart.metric}
                                    metricId={chart.metricId}
                                    name={chart.name}
                                    series={chart.series}
                                    xAxisLabel="Environment"
                                    yAxisLabel={METRIC_LABELS[chart.metric]}
                                />
                            ))}
                            {algoPerfChartSeries.map((chart) => (
                                <ChartCard
                                    key={`perf-${chart.name}`}
                                    metricId={chart.metricId}
                                    name={chart.name}
                                    series={chart.series}
                                    xAxisLabel="Environment"
                                    yAxisLabel={chart.name}
                                />
                            ))}
                        </div>
                    )
                ) : (
                    chartSeries.length === 0 && perfChartSeries.length === 0 || executionState.results.length === 0 ? (
                        <div className="text-center text-sm text-gray-400 py-8">
                            Complete at least one step to render charts
                        </div>
                    ) : (
                        <div className="p-3 flex flex-col gap-3 max-h-112 overflow-y-auto">
                            {chartSeries.map((chart) => (
                                <ChartCard
                                    key={chart.metric}
                                    metricId={chart.metricId}
                                    name={chart.name}
                                    series={chart.series}
                                    xAxisLabel={targetParameterName}
                                    yAxisLabel={METRIC_LABELS[chart.metric]}
                                />
                            ))}
                            {perfChartSeries.map((chart) => (
                                <ChartCard
                                    key={`perf-${chart.name}`}
                                    metricId={chart.metricId}
                                    name={chart.chartName}
                                    series={chart.series}
                                    xAxisLabel={targetParameterName}
                                    yAxisLabel={chart.name}
                                />
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

