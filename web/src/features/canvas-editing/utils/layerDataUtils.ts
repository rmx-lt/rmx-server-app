import type { ComputeResult, ProviderLayerRecord } from "@/data/local/serviceTypes";
import type { ComputeResultRecord } from "@/data/local/schemaTypes";

/**
 * Extracts the raw item array for a given `computeLayer` key from a compute result.
 *
 * - If `computeLayer === "coveragePathPlan"` returns the segments array from the
 *   primary coverage path plan output.
 * - Otherwise walks `result.debug.layers` and returns the `list` of the first
 *   entry whose `source` matches `computeLayer`.
 * - Returns an empty array when no matching data is found.
 *
 * The returned items are typed as `unknown[]`. Callers narrow the type via a
 * type assertion based on the layer's declared `layerType` — the contract is
 * enforced at the API boundary, not at runtime.
 */
export function extractLayerData(result: ComputeResult, computeLayer: string): unknown[] {
    if (computeLayer === "coveragePathPlan") {
        return result.coveragePathPlan.segments;
    }
    const COVERAGE_PATH_PLAN_PREFIX = "coveragePathPlan.";
    if (computeLayer.startsWith(COVERAGE_PATH_PLAN_PREFIX)) {
        const segmentType = computeLayer.slice(COVERAGE_PATH_PLAN_PREFIX.length);
        return result.coveragePathPlan.segments.filter((s) => s.type === segmentType);
    }

    return result.debug?.layers?.find((l) => l.source === computeLayer)?.list ?? [];
}

/**
 * Filters `providerLayers` to those that belong to the algorithm and provider
 * that produced the given result record.
 */
export function getProviderLayersForResult(
    record: ComputeResultRecord,
    providerLayers: ProviderLayerRecord[],
): ProviderLayerRecord[] {
    return providerLayers.filter(
        (l) => l.algorithmId === record.algorithmId && l.providerId === record.providerId,
    );
}
