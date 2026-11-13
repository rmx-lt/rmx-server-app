import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { buildComputationProviderEndpointUrl } from "@/features/computation-provider/utils/computationProviderUrl";
import { useComputationCatalogStore } from "@/model/computationCatalogStore";
import { useEnvStore } from "@/model/envStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useParameterValuesStore } from "@/model/parameterValuesStore";
import { useComputeResultStore } from "@/model/useComputeResultStore";
import {
    parseHeadlandWidth,
    SYSTEM_HEADLAND_PROVIDER_PARAM_NAMES,
} from "@/features/coverage-planning/utils/headlandGeometry";
import { resolveRequestGeometry } from "@/features/coverage-planning/utils/requestGeometry";
import type { AlgoParamType, ComputeJobState, ComputeJobStateCompleted } from "@/data/local/serviceTypes";
import type { ComputeResultRecord } from "@/data/local/schemaTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComputeSubmitResult =
    | { ok: true; jobId: string; pollUrl: string }
    | { ok: false; error: string };

export type ComputeExecuteResult =
    | { ok: true; record: ComputeResultRecord }
    | { ok: false; error: string };

export type BuildRequestBodyResult =
    | { ok: true; body: Record<string, unknown>; provider: { url: string; apiKey: string } }
    | { ok: false; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function buildHeaders(apiKey: string): HeadersInit {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (apiKey.trim() !== "") {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
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

function isNumericParameter(paramType: AlgoParamType): boolean {
    return paramType === "Integer" || paramType === "Decimal";
}

function isNullableParameter(paramName: string, paramType: AlgoParamType): boolean {
    return paramType === "String" && paramName === "Seed";
}

// ─── Shared request body builder ─────────────────────────────────────────────

export function buildComputeRequestBody(): BuildRequestBodyResult {
    const { computation } = useEnvStore.getState();
    const { selectedProviderId, selectedAlgorithmId } = computation;

    if (selectedProviderId === null) {
        return { ok: false, error: "No computation provider selected." };
    }
    if (selectedAlgorithmId === null) {
        return { ok: false, error: "No algorithm selected." };
    }

    const { providers, algorithms, parameters: catalogParameters } = useComputationCatalogStore.getState();

    const provider = providers.find((p) => p.id === selectedProviderId);
    if (!provider) {
        return { ok: false, error: "Selected provider not found in catalog." };
    }

    const algorithm = algorithms.find(
        (a) => a.id === selectedAlgorithmId && a.computationProviderId === selectedProviderId,
    );
    if (!algorithm) {
        return { ok: false, error: "Selected algorithm not found in catalog." };
    }

    const algoParams = catalogParameters.filter(
        (p) => p.algorithmId === selectedAlgorithmId && p.computationProviderId === selectedProviderId,
    );

    const { env } = useEnvStore.getState();
    const headlandEnabled = env.headlandEnabled;
    const headlandWidth = parseHeadlandWidth(env.headlandWidth);

    const systemParamValues: Record<string, number | boolean> = {
        "Headland": headlandEnabled,
        "Headland Width": headlandWidth ?? 0,
    };

    const { parameterValues } = useParameterValuesStore.getState();

    const parameters: Record<string, number | boolean | string | null> = {};
    for (const param of algoParams) {
        if (SYSTEM_HEADLAND_PROVIDER_PARAM_NAMES.has(param.name)) {
            parameters[param.name] = systemParamValues[param.name] ?? null;
            continue;
        }

        const pv = parameterValues.find(
            (v) =>
                v.id === param.id &&
                v.algorithmId === param.algorithmId &&
                v.providerId === param.computationProviderId,
        );

        if (pv === undefined && (isNullableParameter(param.name, param.paramType) || isNumericParameter(param.paramType))) {
            parameters[param.name] = null;
            continue;
        }

        if (pv === undefined) {
            return { ok: false, error: `Missing parameter value for "${param.name}".` };
        }

        if ((isNullableParameter(param.name, param.paramType) || isNumericParameter(param.paramType)) && pv.value.trim() === "") {
            parameters[param.name] = null;
            continue;
        }

        parameters[param.name] = coerceParamValue(pv.value, param.paramType);
    }

    const { objects } = useCanvasObjectStore.getState();

    const zoneObjects = objects.filter((o) => o.category === OBJECT_CATEGORY.ZONE);
    const obstacleObjects = objects.filter((o) => o.category === OBJECT_CATEGORY.OBSTACLE);
    if (zoneObjects.length === 0) {
        return { ok: false, error: "No zone drawn on canvas." };
    }

    const { startPoint, endPoint, startEndPoint } = useEnvPointStore.getState();
    const hasValidPoints = startEndPoint !== null || (startPoint !== null && endPoint !== null);
    if (!hasValidPoints) {
        return { ok: false, error: "Start and end points are required before running the algorithm." };
    }

    const resolvedStart = startPoint ?? startEndPoint!;
    const resolvedEnd = endPoint ?? startEndPoint!;

    const resolvedGeometry = resolveRequestGeometry({
        objects,
        headlandEnabled,
        headlandWidth,
    });
    if (!resolvedGeometry.ok) {
        return resolvedGeometry;
    }

    const { zones, obstacles } = resolvedGeometry;

    const body: Record<string, unknown> = {
        algorithmId: selectedAlgorithmId,
        environment: {
            zones,
            obstacles,
            startPoint: { x: resolvedStart.point.x, y: resolvedStart.point.y },
            endPoint: { x: resolvedEnd.point.x, y: resolvedEnd.point.y },
        },
        ...(headlandEnabled
            ? {
                realworld: {
                    zones: zoneObjects.map((o) => ({
                        vertices: o.vertices.map(({ x, y }) => ({ x, y })),
                    })),
                    obstacles: obstacleObjects.map((o) => ({
                        vertices: o.vertices.map(({ x, y }) => ({ x, y })),
                    })),
                },
            }
            : {}),
        parameters,
    };

    return { ok: true, body, provider: { url: provider.url, apiKey: provider.apiKey } };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function submitComputeRequest(): Promise<ComputeSubmitResult> {
    const bodyResult = buildComputeRequestBody();
    if (!bodyResult.ok) return bodyResult;

    const builtUrl = buildComputationProviderEndpointUrl(bodyResult.provider.url, "/compute");
    if (!builtUrl.ok) {
        return { ok: false, error: `Provider URL is invalid: ${builtUrl.error}` };
    }

    try {
        const response = await fetch(builtUrl.url, {
            method: "POST",
            headers: buildHeaders(bodyResult.provider.apiKey),
            body: JSON.stringify(bodyResult.body),
        });

        const data = await response.json() as Record<string, unknown>;

        if (response.status === 202) {
            return {
                ok: true,
                jobId: data["jobId"] as string,
                pollUrl: data["pollUrl"] as string,
            };
        }

        const errorBody = data["error"] as { message?: string } | undefined;
        return {
            ok: false,
            error: errorBody?.message ?? `Unexpected response status ${response.status}.`,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Request failed: ${message}` };
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────────

// ─── Polling ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 600;
const POLL_MAX_ATTEMPTS = 100; // 60 s

async function pollComputeJob(pollUrl: string, apiKey: string): Promise<ComputeJobState> {
    const headers: HeadersInit = apiKey.trim() !== "" ? { "Authorization": `Bearer ${apiKey}` } : {};
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const response = await fetch(pollUrl, { headers });
        const data = await response.json() as ComputeJobState;
        if (data.status === "completed" || data.status === "failed") {
            return data;
        }
    }
    throw new Error("Compute job timed out after 60 seconds.");
}

// ─── Execute (submit + poll + persist) ───────────────────────────────────────

export async function executeComputeRequest(): Promise<ComputeExecuteResult> {
    const resultStore = useComputeResultStore.getState();
    resultStore.setStatus("submitting");

    const submitResult = await submitComputeRequest();
    if (!submitResult.ok) {
        resultStore.setError(submitResult.error);
        resultStore.setStatus("failed");
        return { ok: false, error: submitResult.error };
    }

    resultStore.setStatus("polling");

    const { computation } = useEnvStore.getState();
    const { providers } = useComputationCatalogStore.getState();
    const provider = providers.find((p) => p.id === computation.selectedProviderId);
    const apiKey = provider?.apiKey ?? "";

    let jobState: ComputeJobState;
    try {
        jobState = await pollComputeJob(submitResult.pollUrl, apiKey);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        resultStore.setError(message);
        resultStore.setStatus("failed");
        return { ok: false, error: message };
    }

    if (jobState.status === "failed") {
        const message = jobState.error?.message ?? "Compute job failed.";
        resultStore.setError(message);
        resultStore.setStatus("failed");
        return { ok: false, error: message };
    }

    const completed = jobState as ComputeJobStateCompleted;
    const { env } = useEnvStore.getState();
    const record: ComputeResultRecord = {
        environmentId: env.id,
        jobId: completed.jobId,
        algorithmId: computation.selectedAlgorithmId!,
        providerId: computation.selectedProviderId!,
        algorithmName: completed.algorithmName,
        completedAt: completed.completedAt ?? new Date().toISOString(),
        result: completed.result,
    };

    resultStore.setResult(record);

    return { ok: true, record };
}
