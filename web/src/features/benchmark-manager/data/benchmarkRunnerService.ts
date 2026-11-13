import { buildComputationProviderEndpointUrl } from "@/features/computation-provider/utils/computationProviderUrl";
import {
    ENV_FORMAT_OPTIONS,
    ENV_TYPE_OPTIONS,
    OBJECT_CATEGORY,
} from "@/config/db-ops/enums";
import { parseHeadlandWidth } from "@/features/coverage-planning/utils/headlandGeometry";
import { resolveRequestGeometry } from "@/features/coverage-planning/utils/requestGeometry";
import { computeNetArea } from "@/features/canvas-editing/utils/canvasGeometry";
import {
    calculateAggregateMetrics,
    type BenchmarkAggregatedMetrics,
    type BenchmarkAlgoEnvResult,
    type BenchmarkAlgoResult,
    type BenchmarkEnvironmentSetup,
    type BenchmarkFixedParameter,
    type BenchmarkGeneratedEnvironment,
    type BenchmarkMetricType,
    type BenchmarkMetricsValues,
    type BenchmarkParameterSetup,
    type BenchmarkRun,
    type BenchmarkStepValueCalculation,
    type BenchmarkSystemEnvironmentSetup,
    type BenchmarkStepResult,
} from "@/features/benchmark-manager/stores/benchmarkModalStore";
import type { Object as CanvasObject } from "@/data/local/schemaTypes";
import {
    buildCoverageVisitMap,
    computeCoverageRatio,
    computeEfficiency,
    computeNumberOfTurns,
    computeOverlapRatio,
    computePathLength,
} from "@/utils/coverageGrid";
import type {
    AlgoParamType,
    AlgorithmMetric,
    AlgorithmParameter,
    ComputationAlgorithm,
    ComputationProvider,
    ComputeJobState,
    ComputeJobStateCompleted,
    PerformanceMetric,
} from "@/data/local/serviceTypes";

export interface BenchmarkProgressUpdate {
    totalSteps: number;
    completedSteps: number;
    totalRuns: number;
    completedRuns: number;
    currentStepValue?: number;
    currentRunIndex?: number;
}

export interface RunBenchmarkConfig {
    provider: ComputationProvider;
    algorithm: ComputationAlgorithm;
    algorithmParameters: AlgorithmParameter[];
    algorithmMetrics: AlgorithmMetric[];
    targetParameterSetup: BenchmarkParameterSetup;
    fixedParameters: BenchmarkFixedParameter[];
    environmentSetup: BenchmarkEnvironmentSetup;
    generatedEnvironments: BenchmarkGeneratedEnvironment[];
    runsPerEnvironment: number;
    systemEnvironmentSetup: BenchmarkSystemEnvironmentSetup;
    selectedMetrics: Set<BenchmarkMetricType>;
    signal?: AbortSignal;
    onProgress?: (progress: BenchmarkProgressUpdate) => void;
    onRunUpdate?: (stepValue: number, runIndex: number, updates: Partial<BenchmarkRun>) => void;
    onStepCompleted?: (result: BenchmarkStepResult) => void;
}

interface ComputeSubmitResult {
    ok: boolean;
    jobId?: string;
    pollUrl?: string;
    error?: string;
}

const POLL_INTERVAL_MS = 600;
const POLL_MAX_ATTEMPTS = 100;

function buildHeaders(apiKey: string): HeadersInit {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    if (apiKey.trim() !== "") {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
}

function isNumericParameter(paramType: AlgoParamType): boolean {
    return paramType === "Integer" || paramType === "Decimal";
}

function isNullableParameter(paramName: string, paramType: AlgoParamType): boolean {
    return paramType === "String" && paramName === "Seed";
}

function coerceParamValue(raw: string, paramType: AlgoParamType): number | boolean | string {
    switch (paramType) {
        case "Integer":
        case "Decimal":
            return Number(raw);
        case "Boolean":
            return raw === "true";
        default:
            return raw;
    }
}

function buildStepValues(setup: BenchmarkParameterSetup): number[] {
    const start = Number(setup.startValue);
    const end = Number(setup.endValue);
    const step = Number(setup.stepValue);

    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) {
        return [];
    }

    const values: number[] = [];
    for (let value = start; value <= end; value += step) {
        values.push(Number(value.toFixed(8)));
    }

    if (values.length === 0 || values[values.length - 1] !== end) {
        values.push(end);
    }

    return values;
}

function computePolygonArea(vertices: Array<{ x: number; y: number }>): number {
    if (vertices.length < 3) return 0;

    let sum = 0;
    for (let i = 0; i < vertices.length; i += 1) {
        const current = vertices[i]!;
        const next = vertices[(i + 1) % vertices.length]!;
        sum += current.x * next.y - next.x * current.y;
    }

    return Math.abs(sum / 2);
}

function toCanvasObjects(
    generated: Pick<BenchmarkGeneratedEnvironment, "boundary" | "obstacles">,
    objectType: CanvasObject["type"],
): {
    objects: CanvasObject[];
    zoneObjects: CanvasObject[];
    obstacleObjects: CanvasObject[];
} {
    const zoneObjects: CanvasObject[] = [
        {
            id: 1,
            environmentId: 0,
            category: OBJECT_CATEGORY.ZONE,
            type: objectType,
            vertexCount: generated.boundary.length,
            area: computePolygonArea(generated.boundary),
            vertices: generated.boundary.map((v) => ({ x: v.x, y: v.y })),
        },
    ];

    const obstacleObjects: CanvasObject[] = generated.obstacles.map((vertices, index) => ({
        id: index + 2,
        environmentId: 0,
        category: OBJECT_CATEGORY.OBSTACLE,
        type: objectType,
        vertexCount: vertices.length,
        area: computePolygonArea(vertices),
        vertices: vertices.map((v) => ({ x: v.x, y: v.y })),
    }));

    return {
        objects: [...zoneObjects, ...obstacleObjects],
        zoneObjects,
        obstacleObjects,
    };
}

function buildFixedParameters(
    algorithmParameters: AlgorithmParameter[],
    fixedParameters: BenchmarkFixedParameter[],
): Record<string, number | boolean | string | null> {
    const fixedById = new Map<number, string>();
    for (const fixed of fixedParameters) {
        fixedById.set(fixed.paramId, fixed.value);
    }

    const parameters: Record<string, number | boolean | string | null> = {};

    for (const param of algorithmParameters) {
        const rawValue = fixedById.get(param.id) ?? param.defaultValue;

        if (rawValue.trim() === "" && (isNullableParameter(param.name, param.paramType) || isNumericParameter(param.paramType))) {
            parameters[param.name] = null;
            continue;
        }

        parameters[param.name] = coerceParamValue(rawValue, param.paramType);
    }

    return parameters;
}

function buildParametersForStep(
    algorithmParameters: AlgorithmParameter[],
    fixedParameters: BenchmarkFixedParameter[],
    targetParameterSetup: BenchmarkParameterSetup,
    stepValue: number,
): Record<string, number | boolean | string | null> {
    const fixedById = new Map<number, string>();
    for (const fixed of fixedParameters) {
        fixedById.set(fixed.paramId, fixed.value);
    }

    const parameters: Record<string, number | boolean | string | null> = {};

    for (const param of algorithmParameters) {
        const rawValue =
            param.id === targetParameterSetup.targetParamId
                ? String(stepValue)
                : fixedById.get(param.id) ?? param.defaultValue;

        if (rawValue.trim() === "" && (isNullableParameter(param.name, param.paramType) || isNumericParameter(param.paramType))) {
            parameters[param.name] = null;
            continue;
        }

        parameters[param.name] = coerceParamValue(rawValue, param.paramType);
    }

    return parameters;
}

function formatToMetadataValue(format: string): string {
    const matchingOption = ENV_FORMAT_OPTIONS.find((option) => option.value === format);
    return matchingOption?.label ?? format;
}

function typeToMetadataValue(type: string): string {
    const matchingOption = ENV_TYPE_OPTIONS.find((option) => option.value === type);
    return matchingOption?.label ?? type;
}

function getSystemEnvironmentParameters(systemEnvironmentSetup: BenchmarkSystemEnvironmentSetup): Record<string, string | boolean> {
    return {
        "Format": formatToMetadataValue(systemEnvironmentSetup.format),
        "Type": typeToMetadataValue(systemEnvironmentSetup.type),
        "Coordinate System": systemEnvironmentSetup.coordinateSystem,
        "Headland": systemEnvironmentSetup.headland,
        "Headland Width": systemEnvironmentSetup.headlandWidth,
    };
}

async function submitComputeRequest(
    provider: ComputationProvider,
    algorithmId: number,
    body: unknown,
    signal?: AbortSignal,
): Promise<ComputeSubmitResult> {
    const builtUrl = buildComputationProviderEndpointUrl(provider.url, "/compute");
    if (!builtUrl.ok) {
        return { ok: false, error: `Provider URL is invalid: ${builtUrl.error}` };
    }

    try {
        const response = await fetch(builtUrl.url, {
            method: "POST",
            headers: buildHeaders(provider.apiKey),
            body: JSON.stringify({ algorithmId, ...((body as Record<string, unknown>) ?? {}) }),
            signal,
        });

        const data = (await response.json()) as Record<string, unknown>;

        if (response.status === 202) {
            return {
                ok: true,
                jobId: data.jobId as string,
                pollUrl: data.pollUrl as string,
            };
        }

        const errorBody = data.error as { message?: string } | undefined;
        return {
            ok: false,
            error: errorBody?.message ?? `Unexpected response status ${response.status}.`,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `Request failed: ${message}` };
    }
}

async function pollComputeJob(
    pollUrl: string,
    apiKey: string,
    signal?: AbortSignal,
): Promise<ComputeJobState> {
    const headers = apiKey.trim() ? { Authorization: `Bearer ${apiKey}` } : undefined;

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
        if (signal?.aborted) {
            throw new Error("Benchmark execution cancelled.");
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const response = await fetch(pollUrl, { headers, signal });
        const data = (await response.json()) as ComputeJobState;

        if (data.status === "completed" || data.status === "failed") {
            return data;
        }
    }

    throw new Error("Compute job timed out after 60 seconds.");
}

function performanceMetricToNumber(metric: PerformanceMetric | undefined): number | null {
    if (!metric) return null;

    if (typeof metric.value === "number") {
        return Number.isFinite(metric.value) ? metric.value : null;
    }

    if (Array.isArray(metric.value)) {
        const last = metric.value[metric.value.length - 1];
        if (typeof last === "number") {
            return Number.isFinite(last) ? last : null;
        }

        if (last && typeof last === "object" && "y" in last && typeof last.y === "number") {
            return Number.isFinite(last.y) ? last.y : null;
        }

        return null;
    }

    return null;
}

function findMetricValueByName(
    algorithmMetrics: AlgorithmMetric[],
    resultMetrics: PerformanceMetric[] | undefined,
    candidates: string[],
): number | null {
    if (!resultMetrics || resultMetrics.length === 0) return null;

    const normalizedCandidates = candidates.map((name) => name.trim().toLowerCase());
    const meta = algorithmMetrics.find((metric) => {
        const metricName = metric.name.trim().toLowerCase();
        return normalizedCandidates.some((candidate) => metricName.includes(candidate));
    });

    if (!meta) return null;
    return performanceMetricToNumber(resultMetrics.find((metric) => metric.id === meta.id));
}

function extractRunMetrics(
    completed: ComputeJobStateCompleted,
    algorithmMetrics: AlgorithmMetric[],
    fallbackInput: {
        objects: CanvasObject[];
        cellSize: number;
        pathWidth: number;
    },
): BenchmarkMetricsValues {
    const resultMetrics = completed.result.performance?.metrics;
    const segments = completed.result.coveragePathPlan.segments;

    const turnsFallback = computeNumberOfTurns(segments);
    const pathLengthFallback = computePathLength(segments);
    const { visitMap } = buildCoverageVisitMap({
        segments,
        cellSize: fallbackInput.cellSize,
        pathWidth: fallbackInput.pathWidth,
    });

    const coverageFallback = computeCoverageRatio({
        visitMap,
        cellSize: fallbackInput.cellSize,
        objects: fallbackInput.objects,
    });
    const overlapFallback = computeOverlapRatio(visitMap);

    const totalNetArea = fallbackInput.objects.reduce((sum, object) => {
        const net = computeNetArea(object, fallbackInput.objects);
        return sum + (net ?? 0);
    }, 0);
    const coveredArea = coverageFallback !== null ? totalNetArea * coverageFallback : 0;
    const efficiencyFallback = computeEfficiency(coveredArea, fallbackInput.pathWidth, pathLengthFallback);

    const coverage =
        findMetricValueByName(algorithmMetrics, resultMetrics, ["coverage ratio", "coverage"]) ?? coverageFallback;
    const overlap =
        findMetricValueByName(algorithmMetrics, resultMetrics, ["overlap ratio", "overlap"]) ?? overlapFallback;
    const efficiency =
        findMetricValueByName(algorithmMetrics, resultMetrics, ["efficiency"]) ?? efficiencyFallback;

    const turns =
        findMetricValueByName(algorithmMetrics, resultMetrics, ["number of turns", "turns", "turn"]) ?? turnsFallback;

    const pathLength =
        findMetricValueByName(algorithmMetrics, resultMetrics, ["path length", "path"]) ?? pathLengthFallback;

    // Extract dynamic performance metrics flagged benchmark=true
    const performance: Record<string, number | null> = {};
    for (const meta of algorithmMetrics) {
        if (meta.benchmark === true) {
            performance[meta.name] = performanceMetricToNumber(resultMetrics?.find((m) => m.id === meta.id));
        }
    }

    return {
        coverage,
        overlap,
        efficiency,
        turns,
        pathLength,
        performance,
    };
}

function aggregateStepRuns(runs: BenchmarkRun[]): BenchmarkAggregatedMetrics {
    const successfulRuns = runs.filter((run) => run.status === "completed" && run.metrics);

    const coverageValues = successfulRuns.map((run) => run.metrics?.coverage ?? null);
    const overlapValues = successfulRuns.map((run) => run.metrics?.overlap ?? null);
    const efficiencyValues = successfulRuns.map((run) => run.metrics?.efficiency ?? null);
    const turnsValues = successfulRuns.map((run) => run.metrics?.turns ?? null);
    const pathLengthValues = successfulRuns.map((run) => run.metrics?.pathLength ?? null);

    const allPerfNames = new Set(successfulRuns.flatMap((run) => Object.keys(run.metrics?.performance ?? {})));
    const performance: Record<string, { median: number | null; average: number | null }> = {};
    for (const name of allPerfNames) {
        performance[name] = calculateAggregateMetrics(successfulRuns.map((run) => run.metrics?.performance[name] ?? null));
    }

    return {
        coverage: calculateAggregateMetrics(coverageValues),
        overlap: calculateAggregateMetrics(overlapValues),
        efficiency: calculateAggregateMetrics(efficiencyValues),
        turns: calculateAggregateMetrics(turnsValues),
        pathLength: calculateAggregateMetrics(pathLengthValues),
        performance,
    };
}

export async function runBenchmark(config: RunBenchmarkConfig): Promise<BenchmarkStepResult[]> {
    const {
        provider,
        algorithm,
        algorithmParameters,
        algorithmMetrics,
        targetParameterSetup,
        fixedParameters,
        environmentSetup,
        generatedEnvironments,
        runsPerEnvironment,
        systemEnvironmentSetup,
        selectedMetrics,
        signal,
        onProgress,
        onRunUpdate,
        onStepCompleted,
    } = config;

    if (generatedEnvironments.length === 0) {
        throw new Error("No environments available. Please generate environments in the Env. Setup tab first.");
    }

    const stepValues = buildStepValues(targetParameterSetup);
    if (stepValues.length === 0) {
        throw new Error("Invalid target parameter range. No benchmark steps could be generated.");
    }

    const totalRuns = stepValues.length * generatedEnvironments.length * runsPerEnvironment;
    let completedRuns = 0;
    const stepResults: BenchmarkStepResult[] = [];

    onProgress?.({
        totalSteps: stepValues.length,
        completedSteps: 0,
        totalRuns,
        completedRuns,
    });

    for (let stepIndex = 0; stepIndex < stepValues.length; stepIndex += 1) {
        const stepValue = stepValues[stepIndex]!;

        if (signal?.aborted) {
            break;
        }

        const runs: BenchmarkRun[] = [];

        for (let envIndex = 0; envIndex < generatedEnvironments.length; envIndex += 1) {
            if (signal?.aborted) {
                break;
            }

            const generatedEnv = generatedEnvironments[envIndex]!;
            const generated = {
                boundary: generatedEnv.boundary,
                obstacles: generatedEnv.obstacles,
                startEndPoint: generatedEnv.startEndPoint,
            };
            const benchmarkObjectType = generatedEnv.objectType;

            const { objects, zoneObjects, obstacleObjects } = toCanvasObjects(generated, benchmarkObjectType);

            const parameters = buildParametersForStep(
                algorithmParameters,
                fixedParameters,
                targetParameterSetup,
                stepValue,
            );

            const systemEnvironmentParameters = getSystemEnvironmentParameters(systemEnvironmentSetup);
            for (const [key, value] of Object.entries(systemEnvironmentParameters)) {
                parameters[key] = value;
            }

            const headlandEnabled = systemEnvironmentSetup.headland;
            const headlandWidth = parseHeadlandWidth(systemEnvironmentSetup.headlandWidth);
            const resolvedGeometry = resolveRequestGeometry({
                objects,
                headlandEnabled,
                headlandWidth,
            });

            let requestBody: Record<string, unknown> | null = null;
            if (resolvedGeometry.ok) {
                requestBody = {
                    environment: {
                        zones: resolvedGeometry.zones,
                        obstacles: resolvedGeometry.obstacles,
                        startPoint: generated.startEndPoint,
                        endPoint: generated.startEndPoint,
                    },
                    parameters,
                };

                if (headlandEnabled) {
                    requestBody.realworld = {
                        zones: zoneObjects.map((o) => ({
                            vertices: o.vertices.map(({ x, y }) => ({ x, y })),
                        })),
                        obstacles: obstacleObjects.map((o) => ({
                            vertices: o.vertices.map(({ x, y }) => ({ x, y })),
                        })),
                    };
                }
            }

            for (let repeatIndex = 0; repeatIndex < runsPerEnvironment; repeatIndex += 1) {
                if (signal?.aborted) {
                    break;
                }

                const runIndex = envIndex * runsPerEnvironment + repeatIndex;

                onProgress?.({
                    totalSteps: stepValues.length,
                    completedSteps: stepIndex,
                    totalRuns,
                    completedRuns,
                    currentStepValue: stepValue,
                    currentRunIndex: runIndex,
                });

                const run: BenchmarkRun = {
                    stepValue,
                    runIndex,
                    status: "running",
                };
                runs.push(run);

                onRunUpdate?.(stepValue, runIndex, { status: "running" });

                if (!resolvedGeometry.ok || !requestBody) {
                    completedRuns += 1;
                    run.status = "skipped";
                    run.error = resolvedGeometry.ok ? "Request body could not be built." : resolvedGeometry.error;
                    onRunUpdate?.(stepValue, runIndex, {
                        status: "skipped",
                        error: run.error,
                    });
                    continue;
                }

                const submitResult = await submitComputeRequest(
                    provider,
                    algorithm.id,
                    requestBody,
                    signal,
                );

                if (!submitResult.ok || !submitResult.pollUrl || !submitResult.jobId) {
                    completedRuns += 1;
                    const error = submitResult.error ?? "Failed to submit benchmark run.";
                    run.status = "skipped";
                    run.error = error;
                    onRunUpdate?.(stepValue, runIndex, { status: "skipped", error });
                    continue;
                }

                run.jobId = submitResult.jobId;
                onRunUpdate?.(stepValue, runIndex, { jobId: submitResult.jobId });

                try {
                    const state = await pollComputeJob(submitResult.pollUrl, provider.apiKey, signal);

                    if (state.status === "failed") {
                        completedRuns += 1;
                        const error = state.error.message;
                        run.status = "failed";
                        run.error = error;
                        run.completedAt = state.completedAt;
                        onRunUpdate?.(stepValue, runIndex, {
                            status: "failed",
                            error,
                            completedAt: state.completedAt,
                        });
                        continue;
                    }

                    const completed = state as ComputeJobStateCompleted;
                    const pathWidthRaw = parameters["Path Width"];
                    const pathWidth =
                        typeof pathWidthRaw === "number"
                            ? pathWidthRaw
                            : typeof pathWidthRaw === "string"
                                ? Number(pathWidthRaw)
                                : NaN;

                    const coverageObjects: CanvasObject[] = [
                        ...resolvedGeometry.zones.map((zone, index) => ({
                            id: index + 1,
                            environmentId: 0,
                            category: OBJECT_CATEGORY.ZONE,
                            type: benchmarkObjectType,
                            vertexCount: zone.vertices.length,
                            area: computePolygonArea(zone.vertices),
                            vertices: zone.vertices.map((v) => ({ x: v.x, y: v.y })),
                        })),
                        ...resolvedGeometry.obstacles.map((obstacle, index) => ({
                            id: resolvedGeometry.zones.length + index + 1,
                            environmentId: 0,
                            category: OBJECT_CATEGORY.OBSTACLE,
                            type: benchmarkObjectType,
                            vertexCount: obstacle.vertices.length,
                            area: computePolygonArea(obstacle.vertices),
                            vertices: obstacle.vertices.map((v) => ({ x: v.x, y: v.y })),
                        })),
                    ];

                    const metrics = extractRunMetrics(completed, algorithmMetrics, {
                        objects: coverageObjects,
                        cellSize: environmentSetup.coverageGridCellSize,
                        pathWidth:
                            Number.isFinite(pathWidth) && pathWidth > 0
                                ? pathWidth
                                : environmentSetup.coverageGridCellSize,
                    });

                    const filteredMetrics: BenchmarkMetricsValues = {
                        coverage: selectedMetrics.has("coverage") ? metrics.coverage : null,
                        overlap: selectedMetrics.has("overlap") ? metrics.overlap : null,
                        efficiency: selectedMetrics.has("efficiency") ? metrics.efficiency : null,
                        turns: selectedMetrics.has("turns") ? metrics.turns : null,
                        pathLength: selectedMetrics.has("pathLength") ? metrics.pathLength : null,
                        performance: metrics.performance,
                    };

                    completedRuns += 1;
                    run.status = "completed";
                    run.metrics = filteredMetrics;
                    run.completedAt = completed.completedAt;

                    onRunUpdate?.(stepValue, runIndex, {
                        status: "completed",
                        metrics: filteredMetrics,
                        completedAt: completed.completedAt,
                    });
                } catch (error) {
                    completedRuns += 1;
                    const message = error instanceof Error ? error.message : String(error);
                    run.status = signal?.aborted ? "skipped" : "failed";
                    run.error = message;
                    onRunUpdate?.(stepValue, runIndex, {
                        status: run.status,
                        error: message,
                    });
                }
            }
        }

        const runsCompleted = runs.filter((run) => run.status === "completed").length;
        const runsFailed = runs.filter((run) => run.status === "failed" || run.status === "skipped").length;

        const stepResult: BenchmarkStepResult = {
            stepValue,
            runsCompleted,
            runsFailed,
            aggregatedMetrics: aggregateStepRuns(runs),
            rawRuns: runs,
        };

        stepResults.push(stepResult);
        onStepCompleted?.(stepResult);

        onProgress?.({
            totalSteps: stepValues.length,
            completedSteps: stepIndex + 1,
            totalRuns,
            completedRuns,
        });
    }

    return stepResults;
}

// ─── Algorithm Eval Runner ───────────────────────────────────────────────────────────

export interface RunAlgorithmEvalSlot {
    provider: ComputationProvider;
    algorithm: ComputationAlgorithm;
    algorithmParameters: AlgorithmParameter[];
    algorithmMetrics: AlgorithmMetric[];
    fixedParameters: BenchmarkFixedParameter[];
    runsPerEnvironment: number;
    stepValueCalculation: BenchmarkStepValueCalculation;
}

export interface RunAlgorithmEvalConfig {
    slots: RunAlgorithmEvalSlot[];
    environmentSetup: BenchmarkEnvironmentSetup;
    generatedEnvironments: BenchmarkGeneratedEnvironment[];
    systemEnvironmentSetup: BenchmarkSystemEnvironmentSetup;
    selectedMetrics: Set<BenchmarkMetricType>;
    signal?: AbortSignal;
    onProgress?: (progress: BenchmarkProgressUpdate) => void;
    onAlgoEnvCompleted?: (algoIndex: number, algorithmId: number, providerId: number, envResult: BenchmarkAlgoEnvResult) => void;
    onAlgoCompleted?: (result: BenchmarkAlgoResult) => void;
}

export async function runAlgorithmEvalBenchmark(config: RunAlgorithmEvalConfig): Promise<BenchmarkAlgoResult[]> {
    const {
        slots,
        environmentSetup,
        generatedEnvironments,
        systemEnvironmentSetup,
        selectedMetrics,
        signal,
        onProgress,
        onAlgoEnvCompleted,
        onAlgoCompleted,
    } = config;

    if (generatedEnvironments.length === 0) {
        throw new Error("No environments available. Please generate environments in the Env. Setup tab first.");
    }

    if (slots.length === 0) {
        throw new Error("No algorithm slots configured.");
    }

    const totalRuns = slots.reduce((sum, slot) => sum + generatedEnvironments.length * slot.runsPerEnvironment, 0);
    let completedRuns = 0;
    const algoResults: BenchmarkAlgoResult[] = [];

    onProgress?.({
        totalSteps: slots.length,
        completedSteps: 0,
        totalRuns,
        completedRuns,
    });

    for (let algoIndex = 0; algoIndex < slots.length; algoIndex += 1) {
        if (signal?.aborted) break;

        const slot = slots[algoIndex]!;
        const { provider, algorithm, algorithmParameters, algorithmMetrics, fixedParameters, runsPerEnvironment } = slot;

        const baseParameters = buildFixedParameters(algorithmParameters, fixedParameters);
        const systemEnvironmentParameters = getSystemEnvironmentParameters(systemEnvironmentSetup);
        for (const [key, value] of Object.entries(systemEnvironmentParameters)) {
            baseParameters[key] = value;
        }

        const headlandEnabled = systemEnvironmentSetup.headland;
        const headlandWidth = parseHeadlandWidth(systemEnvironmentSetup.headlandWidth);

        const pathWidthRaw = baseParameters["Path Width"];
        const pathWidth =
            typeof pathWidthRaw === "number"
                ? pathWidthRaw
                : typeof pathWidthRaw === "string"
                    ? Number(pathWidthRaw)
                    : NaN;
        const effectiveCellSize =
            Number.isFinite(pathWidth) && pathWidth > 0
                ? pathWidth
                : environmentSetup.coverageGridCellSize;

        const envResults: BenchmarkAlgoEnvResult[] = [];

        for (let envIndex = 0; envIndex < generatedEnvironments.length; envIndex += 1) {
            if (signal?.aborted) break;

            const generatedEnv = generatedEnvironments[envIndex]!;
            const generated = {
                boundary: generatedEnv.boundary,
                obstacles: generatedEnv.obstacles,
                startEndPoint: generatedEnv.startEndPoint,
            };
            const benchmarkObjectType = generatedEnv.objectType;

            const { objects, zoneObjects, obstacleObjects } = toCanvasObjects(generated, benchmarkObjectType);

            const resolvedGeometry = resolveRequestGeometry({ objects, headlandEnabled, headlandWidth });

            let requestBody: Record<string, unknown> | null = null;
            if (resolvedGeometry.ok) {
                requestBody = {
                    environment: {
                        zones: resolvedGeometry.zones,
                        obstacles: resolvedGeometry.obstacles,
                        startPoint: generated.startEndPoint,
                        endPoint: generated.startEndPoint,
                    },
                    parameters: baseParameters,
                };

                if (headlandEnabled) {
                    requestBody.realworld = {
                        zones: zoneObjects.map((o) => ({ vertices: o.vertices.map(({ x, y }) => ({ x, y })) })),
                        obstacles: obstacleObjects.map((o) => ({ vertices: o.vertices.map(({ x, y }) => ({ x, y })) })),
                    };
                }
            }

            const repeatMetrics: BenchmarkMetricsValues[] = [];
            let runsCompleted = 0;
            let runsFailed = 0;

            for (let repeatIndex = 0; repeatIndex < runsPerEnvironment; repeatIndex += 1) {
                if (signal?.aborted) break;

                const runIndex = algoIndex * generatedEnvironments.length * runsPerEnvironment
                    + envIndex * runsPerEnvironment
                    + repeatIndex;

                onProgress?.({
                    totalSteps: slots.length,
                    completedSteps: algoIndex,
                    totalRuns,
                    completedRuns,
                    currentStepValue: algoIndex,
                    currentRunIndex: runIndex,
                });

                if (!resolvedGeometry.ok || !requestBody) {
                    completedRuns += 1;
                    runsFailed += 1;
                    continue;
                }

                try {
                    const submitResult = await submitComputeRequest(provider, algorithm.id, requestBody, signal);

                    if (!submitResult.ok || !submitResult.pollUrl) {
                        completedRuns += 1;
                        runsFailed += 1;
                        continue;
                    }

                    const state = await pollComputeJob(submitResult.pollUrl, provider.apiKey, signal);

                    if (state.status === "failed") {
                        completedRuns += 1;
                        runsFailed += 1;
                        continue;
                    }

                    const completed = state as ComputeJobStateCompleted;
                    const coverageObjects: CanvasObject[] = [
                        ...resolvedGeometry.zones.map((zone, index) => ({
                            id: index + 1,
                            environmentId: 0,
                            category: OBJECT_CATEGORY.ZONE,
                            type: benchmarkObjectType,
                            vertexCount: zone.vertices.length,
                            area: computePolygonArea(zone.vertices),
                            vertices: zone.vertices.map((v) => ({ x: v.x, y: v.y })),
                        })),
                        ...resolvedGeometry.obstacles.map((obstacle, index) => ({
                            id: resolvedGeometry.zones.length + index + 1,
                            environmentId: 0,
                            category: OBJECT_CATEGORY.OBSTACLE,
                            type: benchmarkObjectType,
                            vertexCount: obstacle.vertices.length,
                            area: computePolygonArea(obstacle.vertices),
                            vertices: obstacle.vertices.map((v) => ({ x: v.x, y: v.y })),
                        })),
                    ];

                    const metrics = extractRunMetrics(completed, algorithmMetrics, {
                        objects: coverageObjects,
                        cellSize: environmentSetup.coverageGridCellSize,
                        pathWidth: effectiveCellSize,
                    });

                    const filteredMetrics: BenchmarkMetricsValues = {
                        coverage: selectedMetrics.has("coverage") ? metrics.coverage : null,
                        overlap: selectedMetrics.has("overlap") ? metrics.overlap : null,
                        efficiency: selectedMetrics.has("efficiency") ? metrics.efficiency : null,
                        turns: selectedMetrics.has("turns") ? metrics.turns : null,
                        pathLength: selectedMetrics.has("pathLength") ? metrics.pathLength : null,
                        performance: metrics.performance,
                    };

                    repeatMetrics.push(filteredMetrics);
                    completedRuns += 1;
                    runsCompleted += 1;
                } catch {
                    completedRuns += 1;
                    runsFailed += 1;
                }
            }

            // Aggregate repeat runs into a single per-environment metric value
            const allPerfNames = new Set(repeatMetrics.flatMap((m) => Object.keys(m.performance)));
            const envPerformance: Record<string, number | null> = {};
            for (const name of allPerfNames) {
                envPerformance[name] = calculateAggregateMetrics(repeatMetrics.map((m) => m.performance[name] ?? null))[slot.stepValueCalculation];
            }

            const envMetrics: BenchmarkMetricsValues = {
                coverage: calculateAggregateMetrics(repeatMetrics.map((m) => m.coverage))[slot.stepValueCalculation],
                overlap: calculateAggregateMetrics(repeatMetrics.map((m) => m.overlap))[slot.stepValueCalculation],
                efficiency: calculateAggregateMetrics(repeatMetrics.map((m) => m.efficiency))[slot.stepValueCalculation],
                turns: calculateAggregateMetrics(repeatMetrics.map((m) => m.turns))[slot.stepValueCalculation],
                pathLength: calculateAggregateMetrics(repeatMetrics.map((m) => m.pathLength))[slot.stepValueCalculation],
                performance: envPerformance,
            };

            const envResult: BenchmarkAlgoEnvResult = {
                envIndex,
                runsCompleted,
                runsFailed,
                metrics: envMetrics,
            };
            envResults.push(envResult);
            onAlgoEnvCompleted?.(algoIndex, algorithm.id, provider.id!, envResult);
        }

        const aggregatedMetrics: BenchmarkAggregatedMetrics = {
            coverage: calculateAggregateMetrics(envResults.map((e) => e.metrics.coverage)),
            overlap: calculateAggregateMetrics(envResults.map((e) => e.metrics.overlap)),
            efficiency: calculateAggregateMetrics(envResults.map((e) => e.metrics.efficiency)),
            turns: calculateAggregateMetrics(envResults.map((e) => e.metrics.turns)),
            pathLength: calculateAggregateMetrics(envResults.map((e) => e.metrics.pathLength)),
            performance: (() => {
                const allNames = new Set(envResults.flatMap((e) => Object.keys(e.metrics.performance)));
                const perf: Record<string, { median: number | null; average: number | null }> = {};
                for (const name of allNames) {
                    perf[name] = calculateAggregateMetrics(envResults.map((e) => e.metrics.performance[name] ?? null));
                }
                return perf;
            })(),
        };

        const envsCompleted = envResults.filter((e) => e.runsFailed === 0).length;
        const envsFailed = envResults.filter((e) => e.runsFailed > 0).length;

        const algoResult: BenchmarkAlgoResult = {
            algoIndex,
            algorithmId: algorithm.id,
            providerId: provider.id!,
            envResults,
            aggregatedMetrics,
            envsCompleted,
            envsFailed,
        };

        algoResults.push(algoResult);
        onAlgoCompleted?.(algoResult);

        onProgress?.({
            totalSteps: slots.length,
            completedSteps: algoIndex + 1,
            totalRuns,
            completedRuns,
        });
    }

    return algoResults;
}
