import { create } from "zustand";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import type { ObjectType } from "@/config/db-ops/enums";

export interface BenchmarkParameterSetup {
    /** Parameter ID to vary */
    targetParamId: number;
    /** Start value (as string, will be coerced) */
    startValue: string;
    /** End value (as string, will be coerced) */
    endValue: string;
    /** Step size (as string, will be coerced) */
    stepValue: string;
}

export interface BenchmarkFixedParameter {
    paramId: number;
    value: string;
}

export interface BenchmarkEnvironmentSetup {
    /** Width of generated environment */
    width: number;
    /** Height of generated environment */
    height: number;
    /** Cell size for grid generation */
    cellSize: number;
    /** Cell size used when computing coverage grid metrics */
    coverageGridCellSize: number;
    /** Obstacle ratio (0-100) */
    obstacleRatio: number;
    /** Clustering probability (0-100) */
    clusteringProb: number;
}

export interface BenchmarkEnvironmentSetSetup {
    /** Number of environments to create in the set */
    count: number;
    /** Base seed used to derive a unique seed for each environment (empty = randomize) */
    baseSeed: string;
}

export interface BenchmarkGeneratedEnvironment {
    /** 0-based index within the generated set */
    index: number;
    /** Seed string passed to the generator */
    derivedSeed: string;
    boundary: Point[];
    obstacles: Point[][];
    startEndPoint: Point;
    objectType: ObjectType;
    usedSeedHex: string;
    usedClusteringPct: number;
    usedObstacleRatioPct: number;
}

export interface BenchmarkSystemEnvironmentSetup {
    /** Environment format value */
    format: string;
    /** Environment type value */
    type: string;
    /** Coordinate system value */
    coordinateSystem: string;
    /** Whether headland is enabled */
    headland: boolean;
    /** Headland width sent to provider */
    headlandWidth: string;
}

export type BenchmarkStepValueCalculation = "median" | "average";

export type BenchmarkMetricType = "coverage" | "overlap" | "efficiency" | "turns" | "pathLength";

export interface BenchmarkMetricsConfig {
    /** Set of metrics to track during benchmark */
    selectedMetrics: Set<BenchmarkMetricType>;
}

export interface BenchmarkMultipleRunsSetup {
    /** Number of runs to execute for each step value */
    runsPerStep: number;
    /** How to aggregate metric values from multiple runs */
    stepValueCalculation: BenchmarkStepValueCalculation;
}

export interface BenchmarkAlgoMultipleRunsSetup {
    /** Number of independent runs per environment */
    runsPerEnvironment: number;
    /** Number of runs per step value (only used for parameter-eval) */
    runsPerStep: number;
    /** How to aggregate metric values from multiple runs */
    stepValueCalculation: BenchmarkStepValueCalculation;
}

// ─── Job Setup ───────────────────────────────────────────────────────────────

export type BenchmarkJobType = "" | "parameter-eval" | "algorithm-eval";

export interface BenchmarkJobAlgorithm {
    providerId: number | null;
    algorithmId: number | null;
    multipleRunsSetup: BenchmarkAlgoMultipleRunsSetup;
    targetParameterSetup: BenchmarkParameterSetup | null;
    fixedParameters: BenchmarkFixedParameter[];
}

export interface BenchmarkJobSetup {
    type: BenchmarkJobType;
    /** Number of algorithm slots (always 1 for parameter-eval, user-defined for algorithm-eval) */
    algorithmsCount: number;
    /** Per-slot provider+algorithm selections; length === algorithmsCount */
    algorithms: BenchmarkJobAlgorithm[];
}

// ─── Execution & Results ───────────────────────────────────────────────────

export interface BenchmarkMetricsValues {
    coverage: number | null;
    overlap: number | null;
    efficiency: number | null;
    turns: number | null;
    pathLength: number | null;
    /** Dynamic performance metrics flagged benchmark=true, keyed by metric name */
    performance: Record<string, number | null>;
}

export type BenchmarkRunStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export interface BenchmarkRun {
    /** Parameter value being tested */
    stepValue: number;
    /** Which run this is for this step (0-indexed) */
    runIndex: number;
    /** Current status of this run */
    status: BenchmarkRunStatus;
    /** Extracted metrics from computation result */
    metrics?: BenchmarkMetricsValues;
    /** Job ID from provider API */
    jobId?: string;
    /** Error message if failed/skipped */
    error?: string;
    /** When computation completed */
    completedAt?: string;
}

export interface BenchmarkAggregatedMetrics {
    /** Each metric has median and average calculated from all completed runs */
    coverage: { median: number | null; average: number | null };
    overlap: { median: number | null; average: number | null };
    efficiency: { median: number | null; average: number | null };
    turns: { median: number | null; average: number | null };
    pathLength: { median: number | null; average: number | null };
    /** Dynamic performance metrics flagged benchmark=true, keyed by metric name */
    performance: Record<string, { median: number | null; average: number | null }>;
}

export interface BenchmarkStepResult {
    /** The parameter value for this step */
    stepValue: number;
    /** Number of runs that completed successfully */
    runsCompleted: number;
    /** Number of runs that failed/timed out */
    runsFailed: number;
    /** Aggregated metrics (median and average) */
    aggregatedMetrics: BenchmarkAggregatedMetrics;
    /** Raw run data for detail inspection */
    rawRuns: BenchmarkRun[];
}

// ─── Algorithm Eval Results ──────────────────────────────────────────────────

export interface BenchmarkAlgoEnvResult {
    /** 0-based environment index */
    envIndex: number;
    /** Number of successful repeat runs for this environment */
    runsCompleted: number;
    /** Number of failed/skipped repeat runs for this environment */
    runsFailed: number;
    /** Per-environment metrics aggregated across runsPerEnvironment repeats */
    metrics: BenchmarkMetricsValues;
}

export interface BenchmarkAlgoResult {
    /** 0-based algorithm slot index */
    algoIndex: number;
    /** Algorithm ID (from catalog) */
    algorithmId: number;
    /** Provider ID (from catalog) */
    providerId: number;
    /** One entry per generated environment */
    envResults: BenchmarkAlgoEnvResult[];
    /** Metrics aggregated across all environments */
    aggregatedMetrics: BenchmarkAggregatedMetrics;
    /** Number of environments where all runs completed */
    envsCompleted: number;
    /** Number of environments where at least one run failed/was skipped */
    envsFailed: number;
}

export type BenchmarkExecutionStatus = "idle" | "running" | "completed" | "error" | "cancelled";

export interface BenchmarkProgress {
    /** Total number of steps to execute */
    totalSteps: number;
    /** Number of steps completed so far */
    completedSteps: number;
    /** Total number of runs (steps × runsPerStep) */
    totalRuns: number;
    /** Number of runs completed (including failed) */
    completedRuns: number;
    /** Current step value being executed */
    currentStepValue?: number;
    /** Current run index (0-indexed within step) */
    currentRunIndex?: number;
}

export interface BenchmarkExecutionState {
    /** Current execution status */
    status: BenchmarkExecutionStatus;
    /** Progress tracking */
    progress: BenchmarkProgress;
    /** Completed step results (parameter-eval) */
    results: BenchmarkStepResult[];
    /** Completed algorithm results (algorithm-eval) */
    algoResults: BenchmarkAlgoResult[];
    /** AbortController signal for cancellation */
    abortSignal?: AbortSignal;
    /** Error message if execution failed */
    error?: string;
}

interface BenchmarkModalState {
    isOpen: boolean;
    selectedProviderId: number | null;
    selectedAlgorithmId: number | null;
    targetParameterSetup: BenchmarkParameterSetup | null;
    fixedParameters: BenchmarkFixedParameter[];
    environmentSetup: BenchmarkEnvironmentSetup;
    environmentSetSetup: BenchmarkEnvironmentSetSetup;
    systemEnvironmentSetup: BenchmarkSystemEnvironmentSetup;
    multipleRunsSetup: BenchmarkMultipleRunsSetup;
    metricsConfig: BenchmarkMetricsConfig;
    isRunning: boolean;
    error: string | null;

    // Execution & Results
    executionState: BenchmarkExecutionState;

    // Generated environments (stored in memory, not yet persisted to DB)
    generatedEnvironments: BenchmarkGeneratedEnvironment[];
    /** The effective base seed used for the last generation (random hex if baseSeed was empty) */
    generatedBaseSeed: string;

    // Job setup
    jobSetup: BenchmarkJobSetup;

    open: () => void;
    close: () => void;
    setSelectedProvider: (providerId: number | null) => void;
    setSelectedAlgorithm: (algorithmId: number | null) => void;
    setTargetParameterSetup: (setup: BenchmarkParameterSetup) => void;
    setFixedParameter: (paramId: number, value: string) => void;
    removeFixedParameter: (paramId: number) => void;
    setEnvironmentSetup: (setup: Partial<BenchmarkEnvironmentSetup>) => void;
    setEnvironmentSetSetup: (setup: Partial<BenchmarkEnvironmentSetSetup>) => void;
    setSystemEnvironmentSetup: (setup: Partial<BenchmarkSystemEnvironmentSetup>) => void;
    setMultipleRunsSetup: (setup: Partial<BenchmarkMultipleRunsSetup>) => void;
    toggleMetric: (metric: BenchmarkMetricType) => void;
    setMetrics: (metrics: BenchmarkMetricType[]) => void;
    setIsRunning: (running: boolean) => void;
    setError: (error: string | null) => void;
    setGeneratedEnvironments: (envs: BenchmarkGeneratedEnvironment[]) => void;
    setGeneratedBaseSeed: (seed: string) => void;
    setJobSetup: (setup: Partial<BenchmarkJobSetup>) => void;
    setJobAlgorithm: (index: number, update: Partial<BenchmarkJobAlgorithm>) => void;
    reset: () => void;

    // Execution management
    setBenchmarkExecutionState: (state: Partial<BenchmarkExecutionState>) => void;
    addStepResult: (result: BenchmarkStepResult) => void;
    addAlgoResult: (result: BenchmarkAlgoResult) => void;
    addAlgoEnvResult: (algoIndex: number, algorithmId: number, providerId: number, envResult: BenchmarkAlgoEnvResult) => void;
    updateRunProgress: (stepValue: number, runIndex: number, updates: Partial<BenchmarkRun>) => void;
    cancelBenchmark: () => void;
    resetResults: () => void;
}

const INITIAL_EXECUTION_STATE: BenchmarkExecutionState = {
    status: "idle",
    progress: {
        totalSteps: 0,
        completedSteps: 0,
        totalRuns: 0,
        completedRuns: 0,
    },
    results: [],
    algoResults: [],
};

export function calculateAggregateMetrics(values: Array<number | null>): { median: number | null; average: number | null } {
    const validValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (validValues.length === 0) {
        return { median: null, average: null };
    }

    const sorted = [...validValues].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[mid] ?? null);
    const average = validValues.reduce((sum, value) => sum + value, 0) / validValues.length;

    return { median, average };
}

const INITIAL_STATE: Omit<BenchmarkModalState, keyof {
    open: () => void;
    close: () => void;
    setSelectedProvider: () => void;
    setSelectedAlgorithm: () => void;
    setTargetParameterSetup: () => void;
    setFixedParameter: () => void;
    removeFixedParameter: () => void;
    setEnvironmentSetup: () => void;
    setEnvironmentSetSetup: () => void;
    setSystemEnvironmentSetup: () => void;
    setMultipleRunsSetup: () => void;
    toggleMetric: () => void;
    setMetrics: () => void;
    setIsRunning: () => void;
    setError: () => void;
    setGeneratedEnvironments: () => void;
    setGeneratedBaseSeed: () => void;
    setJobSetup: () => void;
    setJobAlgorithm: () => void;
    reset: () => void;
    setBenchmarkExecutionState: () => void;
    addStepResult: () => void;
    addAlgoResult: () => void;
    addAlgoEnvResult: () => void;
    updateRunProgress: () => void;
    cancelBenchmark: () => void;
    resetResults: () => void;
}> = {
    isOpen: false,
    selectedProviderId: null,
    selectedAlgorithmId: null,
    targetParameterSetup: null,
    fixedParameters: [],
    environmentSetup: {
        width: 510,
        height: 510,
        cellSize: 30,
        coverageGridCellSize: 5,
        obstacleRatio: 30,
        clusteringProb: 97,
    },
    environmentSetSetup: {
        count: 20,
        baseSeed: "",
    },
    systemEnvironmentSetup: {
        format: "polygon",
        type: "offline",
        coordinateSystem: "Cartesian",
        headland: true,
        headlandWidth: "4.9",
    },
    multipleRunsSetup: {
        runsPerStep: 3,
        stepValueCalculation: "median",
    },
    metricsConfig: {
        selectedMetrics: new Set(["coverage", "overlap", "efficiency", "turns", "pathLength"] as BenchmarkMetricType[]),
    },
    isRunning: false,
    error: null,
    executionState: INITIAL_EXECUTION_STATE,
    generatedEnvironments: [],
    generatedBaseSeed: "",
    jobSetup: {
        type: "",
        algorithmsCount: 1,
        algorithms: [],
    },
};

export const useBenchmarkModalStore = create<BenchmarkModalState>()((set) => ({
    ...INITIAL_STATE,

    open: () => set({ isOpen: true }),

    close: () => set({ isOpen: false }),

    setSelectedProvider: (providerId) => set({ selectedProviderId: providerId, selectedAlgorithmId: null, targetParameterSetup: null, fixedParameters: [] }),

    setSelectedAlgorithm: (algorithmId) => set({ selectedAlgorithmId: algorithmId, targetParameterSetup: null, fixedParameters: [] }),

    setTargetParameterSetup: (setup) => set({ targetParameterSetup: setup }),

    setFixedParameter: (paramId, value) => {
        set((state) => {
            const existing = state.fixedParameters.find((p) => p.paramId === paramId);
            if (existing) {
                return {
                    fixedParameters: state.fixedParameters.map((p) =>
                        p.paramId === paramId ? { paramId, value } : p,
                    ),
                };
            }
            return {
                fixedParameters: [...state.fixedParameters, { paramId, value }],
            };
        });
    },

    removeFixedParameter: (paramId) => {
        set((state) => ({
            fixedParameters: state.fixedParameters.filter((p) => p.paramId !== paramId),
        }));
    },

    setEnvironmentSetup: (setup) => {
        set((state) => ({
            environmentSetup: { ...state.environmentSetup, ...setup },
        }));
    },

    setEnvironmentSetSetup: (setup) => {
        set((state) => ({
            environmentSetSetup: { ...state.environmentSetSetup, ...setup },
        }));
    },

    setSystemEnvironmentSetup: (setup) => {
        set((state) => ({
            systemEnvironmentSetup: { ...state.systemEnvironmentSetup, ...setup },
        }));
    },

    setMultipleRunsSetup: (setup) => {
        set((state) => ({
            multipleRunsSetup: { ...state.multipleRunsSetup, ...setup },
        }));
    },

    toggleMetric: (metric) => {
        set((state) => {
            const newMetrics = new Set(state.metricsConfig.selectedMetrics);
            if (newMetrics.has(metric)) {
                newMetrics.delete(metric);
            } else {
                newMetrics.add(metric);
            }
            return {
                metricsConfig: { selectedMetrics: newMetrics },
            };
        });
    },

    setMetrics: (metrics) => {
        set({
            metricsConfig: { selectedMetrics: new Set(metrics) },
        });
    },

    setIsRunning: (running) => set({ isRunning: running }),

    setError: (error) => set({ error }),

    setGeneratedEnvironments: (envs) => set({ generatedEnvironments: envs }),
    setGeneratedBaseSeed: (seed) => set({ generatedBaseSeed: seed }),

    setJobSetup: (setup) => {
        set((state) => ({
            jobSetup: { ...state.jobSetup, ...setup },
        }));
    },

    setJobAlgorithm: (index, update) => {
        set((state) => {
            const algorithms = state.jobSetup.algorithms.map((a, i) =>
                i === index ? { ...a, ...update } : a,
            );
            return { jobSetup: { ...state.jobSetup, algorithms } };
        });
    },

    reset: () => set(INITIAL_STATE),

    setBenchmarkExecutionState: (executionPatch) => {
        set((state) => ({
            executionState: {
                ...state.executionState,
                ...executionPatch,
                progress: {
                    ...state.executionState.progress,
                    ...(executionPatch.progress ?? {}),
                },
                results: executionPatch.results ?? state.executionState.results,
            },
        }));
    },

    addStepResult: (result) => {
        set((state) => {
            const nextResults = [...state.executionState.results, result];
            return {
                executionState: {
                    ...state.executionState,
                    results: nextResults,
                    progress: {
                        ...state.executionState.progress,
                        completedSteps: nextResults.length,
                    },
                },
            };
        });
    },

    addAlgoResult: (result) => {
        set((state) => {
            const nextAlgoResults = [...state.executionState.algoResults, result];
            return {
                executionState: {
                    ...state.executionState,
                    algoResults: nextAlgoResults,
                    progress: {
                        ...state.executionState.progress,
                        completedSteps: nextAlgoResults.length,
                    },
                },
            };
        });
    },

    addAlgoEnvResult: (algoIndex, algorithmId, providerId, envResult) => {
        set((state) => {
            const existingIdx = state.executionState.algoResults.findIndex((r) => r.algoIndex === algoIndex);
            let nextAlgoResults: BenchmarkAlgoResult[];

            function aggregatePerformance(envResults: BenchmarkAlgoEnvResult[]): Record<string, { median: number | null; average: number | null }> {
                const allNames = new Set(envResults.flatMap((e) => Object.keys(e.metrics.performance)));
                const result: Record<string, { median: number | null; average: number | null }> = {};
                for (const name of allNames) {
                    result[name] = calculateAggregateMetrics(envResults.map((e) => e.metrics.performance[name] ?? null));
                }
                return result;
            }

            if (existingIdx === -1) {
                const newEnvResults = [envResult];
                const newResult: BenchmarkAlgoResult = {
                    algoIndex,
                    algorithmId,
                    providerId,
                    envResults: newEnvResults,
                    aggregatedMetrics: {
                        coverage: calculateAggregateMetrics(newEnvResults.map((e) => e.metrics.coverage)),
                        overlap: calculateAggregateMetrics(newEnvResults.map((e) => e.metrics.overlap)),
                        efficiency: calculateAggregateMetrics(newEnvResults.map((e) => e.metrics.efficiency)),
                        turns: calculateAggregateMetrics(newEnvResults.map((e) => e.metrics.turns)),
                        pathLength: calculateAggregateMetrics(newEnvResults.map((e) => e.metrics.pathLength)),
                        performance: aggregatePerformance(newEnvResults),
                    },
                    envsCompleted: envResult.runsFailed === 0 ? 1 : 0,
                    envsFailed: envResult.runsFailed > 0 ? 1 : 0,
                };
                nextAlgoResults = [...state.executionState.algoResults, newResult];
            } else {
                const existing = state.executionState.algoResults[existingIdx]!;
                const updatedEnvResults = [...existing.envResults, envResult];
                const updatedResult: BenchmarkAlgoResult = {
                    ...existing,
                    envResults: updatedEnvResults,
                    aggregatedMetrics: {
                        coverage: calculateAggregateMetrics(updatedEnvResults.map((e) => e.metrics.coverage)),
                        overlap: calculateAggregateMetrics(updatedEnvResults.map((e) => e.metrics.overlap)),
                        efficiency: calculateAggregateMetrics(updatedEnvResults.map((e) => e.metrics.efficiency)),
                        turns: calculateAggregateMetrics(updatedEnvResults.map((e) => e.metrics.turns)),
                        pathLength: calculateAggregateMetrics(updatedEnvResults.map((e) => e.metrics.pathLength)),
                        performance: aggregatePerformance(updatedEnvResults),
                    },
                    envsCompleted: existing.envsCompleted + (envResult.runsFailed === 0 ? 1 : 0),
                    envsFailed: existing.envsFailed + (envResult.runsFailed > 0 ? 1 : 0),
                };
                nextAlgoResults = state.executionState.algoResults.map((r, i) =>
                    i === existingIdx ? updatedResult : r,
                );
            }

            return {
                executionState: {
                    ...state.executionState,
                    algoResults: nextAlgoResults,
                },
            };
        });
    },

    updateRunProgress: (stepValue, runIndex, updates) => {
        set((state) => {
            let shouldIncrementCompletedRuns = false;

            const nextResults = state.executionState.results.map((stepResult) => {
                if (stepResult.stepValue !== stepValue) return stepResult;

                if (runIndex < 0 || runIndex >= stepResult.rawRuns.length) return stepResult;

                const nextRawRuns = [...stepResult.rawRuns];
                const baseRun = nextRawRuns[runIndex];
                if (!baseRun) return stepResult;

                const nextStatus = updates.status ?? baseRun.status;
                const wasTerminal = baseRun.status === "completed" || baseRun.status === "failed" || baseRun.status === "skipped";
                const isTerminal = nextStatus === "completed" || nextStatus === "failed" || nextStatus === "skipped";
                if (!wasTerminal && isTerminal) {
                    shouldIncrementCompletedRuns = true;
                }

                nextRawRuns[runIndex] = {
                    stepValue: baseRun.stepValue,
                    runIndex: baseRun.runIndex,
                    status: nextStatus,
                    metrics: updates.metrics ?? baseRun.metrics,
                    jobId: updates.jobId ?? baseRun.jobId,
                    error: updates.error ?? baseRun.error,
                    completedAt: updates.completedAt ?? baseRun.completedAt,
                };

                return {
                    ...stepResult,
                    rawRuns: nextRawRuns,
                };
            });

            return {
                executionState: {
                    ...state.executionState,
                    results: nextResults,
                    progress: {
                        ...state.executionState.progress,
                        completedRuns: shouldIncrementCompletedRuns
                            ? Math.min(
                                state.executionState.progress.totalRuns,
                                state.executionState.progress.completedRuns + 1,
                            )
                            : state.executionState.progress.completedRuns,
                    },
                },
            };
        });
    },

    cancelBenchmark: () => {
        set((state) => ({
            isRunning: false,
            executionState: {
                ...state.executionState,
                status: "cancelled",
                abortSignal: undefined,
            },
        }));
    },

    resetResults: () => {
        set(() => ({
            executionState: {
                ...INITIAL_EXECUTION_STATE,
                results: [],
                algoResults: [],
            },
            error: null,
        }));
    },
}));
