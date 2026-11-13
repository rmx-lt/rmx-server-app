import {
    getCoverageGridVisitCache,
    saveCoverageGridVisitCache,
} from "@/data/local/coverageGridVisitCache";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useComputationCatalogStore } from "@/model/computationCatalogStore";
import { useComputeResultStore, type CoverageMetricsState } from "@/model/useComputeResultStore";
import { useEnvStore } from "@/model/envStore";
import { getLayerParam, useLayerSettingsStore } from "@/model/layerSettingsStore";
import { useParameterValuesStore } from "@/model/parameterValuesStore";
import type { CoverageGridVisitCacheRecord } from "@/data/local/schemaTypes";
import { computeNetArea } from "@/features/canvas-editing/utils/canvasGeometry";
import {
    buildCoverageVisitMap,
    computeCoverageRatio,
    computeEfficiency,
    computeNumberOfTurns,
    computeOverlapRatio,
    computePathLength,
    computeResultSignature,
    resolvePathWidth,
    serializeVisitMap,
} from "@/utils/coverageGrid";

function resolveCellSizeFromLayers(): number {
    const layers = useLayerSettingsStore.getState().layers;
    const raw = parseFloat(
        getLayerParam(layers, LAYER_ID.COVERAGE_GRID, LAYER_PARAM_KEY.COVERAGE_GRID_CELL_SIZE) ?? "1",
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function resolveNumericMetricValueByName(
    metricName: "coverage ratio" | "overlap ratio" | "number of turns" | "path length",
): number | null {
    const result = useComputeResultStore.getState().result;
    if (!result) return null;

    const catalogMetrics = useComputationCatalogStore.getState().metrics;
    const algorithmMetrics = catalogMetrics.filter(
        (m) => m.algorithmId === result.algorithmId && m.computationProviderId === result.providerId,
    );

    const meta =
        algorithmMetrics.find((m) => m.name.trim().toLowerCase() === metricName) ??
        algorithmMetrics.find((m) => {
            const n = m.name.toLowerCase();
            if (metricName === "coverage ratio") return n.includes("coverage") && n.includes("ratio");
            if (metricName === "overlap ratio") return n.includes("overlap") && n.includes("ratio");
            if (metricName === "path length") return n.includes("path") && n.includes("length");
            return n.includes("turn");
        });

    const value = meta
        ? result.result.performance?.metrics.find((m) => m.id === meta.id)?.value
        : undefined;

    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toOverlapPct(metricValue: number | null, fallbackPct: number | null): number | null {
    if (metricValue !== null) {
        return metricValue < 10 ? metricValue * 100 : metricValue;
    }
    if (fallbackPct === null || !Number.isFinite(fallbackPct)) return null;
    return fallbackPct;
}

function toTurnCount(metricValue: number | null, fallbackTurns: number): number {
    if (metricValue !== null) return Math.round(metricValue);
    return fallbackTurns;
}

function toPathLength(metricValue: number | null, fallbackLength: number): number {
    if (metricValue !== null && Number.isFinite(metricValue)) return metricValue;
    return fallbackLength;
}

function toCoverageMetricsState(record: CoverageGridVisitCacheRecord, source: CoverageMetricsState["source"]): CoverageMetricsState {
    return {
        resultSignature: record.resultSignature,
        cellSize: record.cellSize,
        pathWidth: record.pathWidth,
        coverageRatioPct: record.coverageRatioPct,
        overlapRatioPct: record.overlapRatioPct,
        turnCount: record.turnCount,
        pathLength: record.pathLength,
        efficiency: record.efficiency,
        visitEntries: record.visitEntries,
        maxCount: record.maxCount,
        source,
        computedAt: record.createdAt,
    };
}

let inFlightRunId = 0;

export async function hydrateCoverageCacheForCurrentResult(): Promise<void> {
    const result = useComputeResultStore.getState().result;
    if (!result) {
        useComputeResultStore.getState().clearCoverageMetrics();
        return;
    }

    const runId = ++inFlightRunId;
    const cellSize = resolveCellSizeFromLayers();
    const resultSignature = computeResultSignature(result);
    const environmentId = result.environmentId;

    const catalogParams = useComputationCatalogStore.getState().parameters;
    const parameterValues = useParameterValuesStore.getState().parameterValues;

    const pathWidth = resolvePathWidth({
        result,
        catalogParams,
        parameterValues,
        fallback: cellSize,
    });

    const cached = await getCoverageGridVisitCache(environmentId);
    if (runId !== inFlightRunId) return;

    const currentResult = useComputeResultStore.getState().result;
    if (!currentResult || computeResultSignature(currentResult) !== resultSignature) return;

    if (
        cached &&
        cached.resultSignature === resultSignature &&
        cached.cellSize === cellSize &&
        cached.pathWidth === pathWidth
    ) {
        useComputeResultStore.getState().setCoverageMetrics(toCoverageMetricsState(cached, "cache"));
        return;
    }

    const allObjects = useCanvasObjectStore.getState().objects;
    const objects = allObjects.filter((o) => o.environmentId === environmentId);

    const { visitMap, maxCount } = buildCoverageVisitMap({
        segments: result.result.coveragePathPlan.segments,
        cellSize,
        pathWidth,
    });

    const fallbackCoverageRatio = computeCoverageRatio({ visitMap, cellSize, objects });
    const fallbackOverlapPct = computeOverlapRatio(visitMap);
    const fallbackTurns = computeNumberOfTurns(result.result.coveragePathPlan.segments);
    const fallbackPathLength = computePathLength(result.result.coveragePathPlan.segments);

    const totalNetArea = objects.reduce((sum, o) => sum + (computeNetArea(o, objects) ?? 0), 0);
    const overlapMetricValue = resolveNumericMetricValueByName("overlap ratio");
    const turnsMetricValue = resolveNumericMetricValueByName("number of turns");
    const pathLengthMetricValue = resolveNumericMetricValueByName("path length");

    const resolvedPathLength = toPathLength(pathLengthMetricValue, fallbackPathLength);
    const resolvedCoverageRatioPct = fallbackCoverageRatio !== null && Number.isFinite(fallbackCoverageRatio)
        ? fallbackCoverageRatio * 100
        : null;
    const coveredArea =
        resolvedCoverageRatioPct !== null
            ? totalNetArea * (resolvedCoverageRatioPct / 100)
            : totalNetArea;

    const record: CoverageGridVisitCacheRecord = {
        environmentId,
        resultSignature,
        cellSize,
        pathWidth,
        visitEntries: serializeVisitMap(visitMap),
        maxCount,
        coverageRatioPct: resolvedCoverageRatioPct,
        overlapRatioPct: toOverlapPct(overlapMetricValue, fallbackOverlapPct),
        turnCount: toTurnCount(turnsMetricValue, fallbackTurns),
        pathLength: resolvedPathLength,
        efficiency: computeEfficiency(coveredArea, pathWidth, resolvedPathLength),
        createdAt: new Date().toISOString(),
    };

    await saveCoverageGridVisitCache(record);
    if (runId !== inFlightRunId) return;

    const latestResult = useComputeResultStore.getState().result;
    if (!latestResult || computeResultSignature(latestResult) !== resultSignature) return;

    useComputeResultStore.getState().setCoverageMetrics(toCoverageMetricsState(record, "computed"));
}

let stopSync: (() => void) | null = null;

export function startCoverageCacheSync(): () => void {
    if (stopSync) return stopSync;

    const unsubResult = useComputeResultStore.subscribe((next, prev) => {
        if (next.result !== prev.result) {
            void hydrateCoverageCacheForCurrentResult();
        }
    });

    const unsubLayers = useLayerSettingsStore.subscribe((next, prev) => {
        const nextCellSize = parseFloat(
            getLayerParam(next.layers, LAYER_ID.COVERAGE_GRID, LAYER_PARAM_KEY.COVERAGE_GRID_CELL_SIZE) ?? "1",
        );
        const prevCellSize = parseFloat(
            getLayerParam(prev.layers, LAYER_ID.COVERAGE_GRID, LAYER_PARAM_KEY.COVERAGE_GRID_CELL_SIZE) ?? "1",
        );
        if (nextCellSize !== prevCellSize) {
            void hydrateCoverageCacheForCurrentResult();
        }
    });

    const unsubEnv = useEnvStore.subscribe((next, prev) => {
        if (next.env.id !== prev.env.id) {
            void hydrateCoverageCacheForCurrentResult();
        }
    });

    stopSync = () => {
        unsubResult();
        unsubLayers();
        unsubEnv();
        stopSync = null;
    };

    void hydrateCoverageCacheForCurrentResult();

    return stopSync;
}
