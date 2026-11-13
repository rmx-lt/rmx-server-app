import { buildComputationProviderEndpointUrl } from "@/features/computation-provider/utils/computationProviderUrl";
import { buildComputeRequestBody, buildHeaders } from "./computeService";
import { useCppDebugStore } from "@/features/coverage-planning/stores/cppDebugStore";
import { useEnvStore } from "@/model/envStore";
import type { ComputeResult, CoveragePathPlan, AlgorithmDebug, AlgorithmPerformance } from "@/data/local/serviceTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StartDebugResult =
    | { ok: true; sessionId: string; totalSteps: number }
    | { ok: false; error: string };

/**
 * A step result carries the full partial compute result (snapshot).
 * `result` is identical in shape to a normal compute response but with
 * `coveragePathPlan.segments` containing only the segments revealed so far.
 */
export type StepDebugResult =
    | { ok: true; stepIndex: number; totalSteps: number; done: boolean; result: ComputeResult }
    | { ok: false; error: string };

export type RestartDebugResult =
    | { ok: true; sessionId: string; totalSteps: number; stepIndex: number }
    | { ok: false; error: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDebugMeta(data: Record<string, unknown>) {
    const meta = data["_debug"] as Record<string, unknown> | undefined;
    return {
        stepIndex: meta?.["stepIndex"] as number,
        totalSteps: meta?.["totalSteps"] as number,
        done: meta?.["done"] as boolean,
    };
}

function extractComputeResult(data: Record<string, unknown>): ComputeResult {
    return {
        coveragePathPlan: data["coveragePathPlan"] as CoveragePathPlan,
        debug: data["debug"] as AlgorithmDebug | undefined,
        performance: data["performance"] as AlgorithmPerformance | undefined,
    };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function startDebugSession(): Promise<StartDebugResult> {
    const bodyResult = buildComputeRequestBody();
    if (!bodyResult.ok) return bodyResult;

    const builtUrl = buildComputationProviderEndpointUrl(bodyResult.provider.url, "/compute/debug");
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

        if (!response.ok) {
            const message = (data["error"] as Record<string, unknown> | undefined)?.["message"];
            return { ok: false, error: typeof message === "string" ? message : `Server error ${response.status}` };
        }

        const sessionId = data["sessionId"] as string;
        const totalSteps = data["totalSteps"] as number;

        const store = useCppDebugStore.getState();
        store.setSessionId(sessionId);
        store.setTotalSteps(totalSteps);
        store.setCurrentStep(0);

        // Capture algorithm + provider context so the debug layer can filter provider layers.
        const { computation } = useEnvStore.getState();
        if (computation.selectedAlgorithmId !== null && computation.selectedProviderId !== null) {
            store.setSessionContext(computation.selectedAlgorithmId, computation.selectedProviderId);
        }

        store.startDebug();

        return { ok: true, sessionId, totalSteps };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
}

export async function stepDebugSession(): Promise<StepDebugResult> {
    const { sessionId } = useCppDebugStore.getState();
    if (!sessionId) {
        return { ok: false, error: "No active debug session." };
    }

    const bodyResult = buildComputeRequestBody();
    if (!bodyResult.ok) return bodyResult;

    const builtUrl = buildComputationProviderEndpointUrl(bodyResult.provider.url, `/compute/debug/${encodeURIComponent(sessionId)}/step`);
    if (!builtUrl.ok) {
        return { ok: false, error: `Provider URL is invalid: ${builtUrl.error}` };
    }

    try {
        const response = await fetch(builtUrl.url, {
            method: "POST",
            headers: buildHeaders(bodyResult.provider.apiKey),
        });

        // The step response IS a full compute result snapshot with _debug metadata merged in.
        const data = await response.json() as Record<string, unknown>;

        if (!response.ok) {
            const message = (data["error"] as Record<string, unknown> | undefined)?.["message"];
            return { ok: false, error: typeof message === "string" ? message : `Server error ${response.status}` };
        }

        const { stepIndex, totalSteps, done } = extractDebugMeta(data);
        const computeResult = extractComputeResult(data);

        const store = useCppDebugStore.getState();
        store.setCurrentStep(stepIndex);
        store.setCurrentResult(computeResult);

        return { ok: true, stepIndex, totalSteps, done, result: computeResult };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
}

export async function restartDebugSession(): Promise<RestartDebugResult> {
    const { sessionId } = useCppDebugStore.getState();
    if (!sessionId) {
        return { ok: false, error: "No active debug session." };
    }

    const bodyResult = buildComputeRequestBody();
    if (!bodyResult.ok) return bodyResult;

    const builtUrl = buildComputationProviderEndpointUrl(bodyResult.provider.url, `/compute/debug/${encodeURIComponent(sessionId)}/restart`);
    if (!builtUrl.ok) {
        return { ok: false, error: `Provider URL is invalid: ${builtUrl.error}` };
    }

    try {
        const response = await fetch(builtUrl.url, {
            method: "POST",
            headers: buildHeaders(bodyResult.provider.apiKey),
        });

        const data = await response.json() as Record<string, unknown>;

        if (!response.ok) {
            const message = (data["error"] as Record<string, unknown> | undefined)?.["message"];
            return { ok: false, error: typeof message === "string" ? message : `Server error ${response.status}` };
        }

        useCppDebugStore.getState().clearCurrentResult();

        return {
            ok: true,
            sessionId: data["sessionId"] as string,
            totalSteps: data["totalSteps"] as number,
            stepIndex: data["stepIndex"] as number,
        };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
}

export async function fastForwardDebugSession(): Promise<void> {
    const { sessionId } = useCppDebugStore.getState();
    if (!sessionId) return;

    const bodyResult = buildComputeRequestBody();
    if (!bodyResult.ok) return;

    const builtUrl = buildComputationProviderEndpointUrl(
        bodyResult.provider.url,
        `/compute/debug/${encodeURIComponent(sessionId)}/fast-forward`,
    );
    if (!builtUrl.ok) return;

    try {
        const response = await fetch(builtUrl.url, {
            method: "POST",
            headers: buildHeaders(bodyResult.provider.apiKey),
        });
        if (!response.ok) return;

        const data = await response.json() as Record<string, unknown>;
        const { stepIndex } = extractDebugMeta(data);
        const computeResult = extractComputeResult(data);

        const store = useCppDebugStore.getState();
        store.setCurrentStep(stepIndex);
        store.setCurrentResult(computeResult);
    } catch {
        // silent — session is transient
    }
}

export async function stopDebugSession(): Promise<void> {
    const { sessionId } = useCppDebugStore.getState();
    // Always reset store state, even if the server call fails
    useCppDebugStore.getState().stopDebug();

    if (!sessionId) return;

    const bodyResult = buildComputeRequestBody();
    if (!bodyResult.ok) return;

    const builtUrl = buildComputationProviderEndpointUrl(bodyResult.provider.url, `/compute/debug/${encodeURIComponent(sessionId)}`);
    if (!builtUrl.ok) return;

    try {
        await fetch(builtUrl.url, {
            method: "DELETE",
            headers: buildHeaders(bodyResult.provider.apiKey),
        });
    } catch {
        // Silent — session is transient, no need to surface this error
    }
}

