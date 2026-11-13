import type {
    ComputationProvider,
    MetadataResponse,
    ServiceHttpResponseDetails,
    TestConnectionResult,
    FetchMetadataResult,
    FetchMetadataPreviewResult,
    FetchedComputationMetadata,
    ProviderLayerRecord,
} from "@/data/local/serviceTypes";
import type { LayerRecord, LayerSettingsSetup } from "@/data/local/layerTypes";
import { POINT_LABEL_ENUM_VALUES_SETUP_ID, STYLE_ATTRIBUTE_KEY_ID } from "@/config/computation/supportedLayerAttributes";
import { db } from "@/data/local/db";
import { getAlgorithmParametersByEnvironment } from "@/data/local/computationAlgorithmParameters";
import { deleteComputationProvider, updateMetadataTimestamp } from "@/data/local/computationProviders";
import { buildComputationProviderEndpointUrl } from "@/features/computation-provider/utils/computationProviderUrl";
import { useComputationCatalogStore } from "@/model/computationCatalogStore";
import { useProviderLayerStore } from "@/model/providerLayerStore";
import { useEnvStore } from "@/model/envStore";
import { loadLayerSettings } from "@/model/layerSettingsStore";
import { useParameterValuesStore } from "@/model/parameterValuesStore";
import { addMissingLayerSettingsForEnvironment } from "@/data/local/layerSettings";
import { ingestProviderMetadata } from "@/features/computation-provider/data/metadataBridge";
import { deleteAlgorithmMetricsByProvider, bulkPutMetrics } from "@/data/local/computationAlgorithmMetricsSetup";

// ─── Request builder ──────────────────────────────────────────────────────────

function buildHeaders(apiKey: string): HeadersInit {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (apiKey.trim() !== "") {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
}

function getRequestErrorMessage(err: unknown, fallbackMessage: string): string {
    if (err instanceof DOMException && err.name === "TimeoutError") {
        return fallbackMessage;
    }

    if (err instanceof TypeError) {
        return "Request failed. Ensure the service URL is reachable from the browser, the container port is published, and CORS allows this app origin.";
    }

    if (err instanceof Error) {
        return err.message;
    }

    return String(err);
}

function isHtmlResponse(response: Response): boolean {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    return contentType.includes("text/html");
}

function getHttpResponseDetails(response: Response): ServiceHttpResponseDetails {
    return {
        statusCode: response.status,
        statusText: response.statusText,
    };
}

function buildAlgorithmParameterKey(id: number, algorithmId: number, providerId: number): string {
    return `${id}:${algorithmId}:${providerId}`;
}

function buildLayerSettingKey(id: number, layerId: number, algorithmId: number, providerId: number): string {
    return `${id}:${layerId}:${algorithmId}:${providerId}`;
}

async function requestMetadata(provider: ComputationProvider): Promise<
    | ({ ok: true; data: MetadataResponse } & ServiceHttpResponseDetails)
    | ({ ok: false; error: string } & Partial<ServiceHttpResponseDetails>)
> {
    const endpoint = buildComputationProviderEndpointUrl(provider.url, "metadata");
    if (!endpoint.ok) {
        return endpoint;
    }

    try {
        const response = await fetch(endpoint.url, {
            method: "GET",
            headers: buildHeaders(provider.apiKey),
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            return {
                ok: false,
                error: "Provider returned an error response.",
                ...getHttpResponseDetails(response),
            };
        }

        if (isHtmlResponse(response)) {
            return {
                ok: false,
                error: "Service URL returned HTML instead of provider metadata. Check that it points to the provider container, not this app.",
                ...getHttpResponseDetails(response),
            };
        }

        return {
            ok: true,
            data: (await response.json()) as MetadataResponse,
            ...getHttpResponseDetails(response),
        };
    } catch (err) {
        return { ok: false, error: getRequestErrorMessage(err, "Metadata request timed out after 30 seconds.") };
    }
}

export async function fetchMetadataPreview(provider: ComputationProvider): Promise<FetchMetadataPreviewResult> {
    const result = await requestMetadata(provider);
    if (!result.ok) {
        return result;
    }

    const ingestResult = ingestProviderMetadata(provider.id ?? 0, result.data);
    if (!ingestResult.ok) {
        return { ...ingestResult, statusCode: result.statusCode, statusText: result.statusText };
    }

    return {
        ok: true,
        algorithmCount: result.data.algorithms.length,
        metadata: {
            metadataFetchedAt: Date.now(),
            urlAtLastFetch: provider.url.trim(),
            algorithms: ingestResult.algorithms,
        },
        statusCode: result.statusCode,
        statusText: result.statusText,
    };
}

export async function persistFetchedMetadata(
    providerId: number,
    metadata: FetchedComputationMetadata,
): Promise<void> {
    const setupRecords: LayerSettingsSetup[] = metadata.algorithms.flatMap(({ algorithm, layers }) =>
        layers.flatMap((l: ProviderLayerRecord) => {
            const styleRows: LayerSettingsSetup[] = [
                ...l.generalStyleAttributes.map((attr) => ({ ...attr, styleGroup: "general" as const })),
                ...l.pointStyleAttributes.map((attr) => ({ ...attr, styleGroup: "point" as const })),
                ...l.lineStyleAttributes.map((attr) => ({ ...attr, styleGroup: "line" as const })),
                ...l.polygonStyleAttributes.map((attr) => ({ ...attr, styleGroup: "polygon" as const })),
            ].map((attr) => ({
                id: STYLE_ATTRIBUTE_KEY_ID.get(attr.key) ?? 0,
                layerId: l.id,
                algorithmId: algorithm.id,
                providerId,
                key: attr.key,
                styleType: attr.styleType,
                styleGroup: attr.styleGroup,
                defaultValue: attr.defaultValue,
            }));

            if (l.pointLabelEnumValues.length > 0) {
                styleRows.unshift({
                    id: POINT_LABEL_ENUM_VALUES_SETUP_ID,
                    layerId: l.id,
                    algorithmId: algorithm.id,
                    providerId,
                    key: "Point Label Enum Values",
                    styleType: "PointLabelEnum",
                    styleGroup: "point",
                    defaultValue: l.pointLabelEnumValues.join(", "),
                    enumValues: l.pointLabelEnumValues,
                    mapping: l.pointLabelColorMapping,
                });
            }

            return styleRows;
        }),
    );

    const algorithms = metadata.algorithms.map(({ algorithm }) => ({
        ...algorithm,
        computationProviderId: providerId,
    }));
    const parameters = metadata.algorithms.flatMap(({ parameters }) =>
        parameters.map((parameter) => ({
            ...parameter,
            computationProviderId: providerId,
        })),
    );
    const metrics = metadata.algorithms.flatMap(({ metrics: algoMetrics }) =>
        algoMetrics.map((metric) => ({ ...metric, computationProviderId: providerId })),
    );
    const layerRecords: LayerRecord[] = metadata.algorithms.flatMap(({ algorithm, layers }) =>
        layers.map((l: ProviderLayerRecord) => ({
            id: l.id,
            algorithmId: algorithm.id,
            providerId,
            label: l.name,
            computeLayer: l.computeLayer,
            type: l.layerType,
        })),
    );
    const validAlgorithmIds = new Set(algorithms.map((algorithm) => algorithm.id));
    const validParameterKeys = new Set(
        parameters.map((parameter) => buildAlgorithmParameterKey(parameter.id, parameter.algorithmId, parameter.computationProviderId)),
    );
    const validLayerSettingKeys = new Set(
        setupRecords.map((setup) => buildLayerSettingKey(setup.id, setup.layerId, setup.algorithmId, setup.providerId)),
    );

    await db.transaction("rw", [
        db.table("computationProviderAlgorithms"),
        db.table("computationAlgorithmParametersSetup"),
        db.table("algorithmMetricsSetup"),
        db.table("computationAlgorithmParameters"),
        db.table("computationSelection"),
        db.table("layers"),
        db.table("layerSettingsSetup"),
        db.table("layerSettings"),
    ], async () => {
        await db.table("computationAlgorithmParametersSetup").where("computationProviderId").equals(providerId).delete();
        await db.table("computationProviderAlgorithms").where("computationProviderId").equals(providerId).delete();
        await deleteAlgorithmMetricsByProvider(providerId);
        await db.table("layers").where("providerId").equals(providerId).delete();
        await db.table("layerSettingsSetup").filter((row) => row.providerId === providerId).delete();

        if (algorithms.length > 0) {
            await db.table("computationProviderAlgorithms").bulkPut(algorithms);
        }

        if (parameters.length > 0) {
            await db.table("computationAlgorithmParametersSetup").bulkPut(parameters);
        }

        const metrics = metadata.algorithms.flatMap(({ metrics: algoMetrics }) =>
            algoMetrics.map((m) => ({ ...m, computationProviderId: providerId })),
        );
        if (metrics.length > 0) {
            await bulkPutMetrics(metrics);
        }

        if (layerRecords.length > 0) {
            await db.table("layers").bulkPut(layerRecords);
        }

        if (setupRecords.length > 0) {
            await db.table("layerSettingsSetup").bulkPut(setupRecords);
        }

        await db.table("computationAlgorithmParameters")
            .filter(
                (row) => row.providerId === providerId
                    && !validParameterKeys.has(buildAlgorithmParameterKey(row.id, row.algorithmId, row.providerId)),
            )
            .delete();
        await db.table("layerSettings")
            .filter(
                (row) => row.providerId === providerId
                    && !validLayerSettingKeys.has(buildLayerSettingKey(row.id, row.layerId, row.algorithmId, row.providerId)),
            )
            .delete();
        await db.table("computationSelection")
            .filter(
                (row) => row.selectedProviderId === providerId
                    && row.selectedAlgorithmId !== null
                    && !validAlgorithmIds.has(row.selectedAlgorithmId),
            )
            .modify({ selectedAlgorithmId: null });
    });

    const environmentIds = (await db.table("environments").orderBy("id").keys()) as number[];
    if (setupRecords.length > 0 && environmentIds.length > 0) {
        await Promise.all(environmentIds.map((environmentId) => addMissingLayerSettingsForEnvironment(environmentId, setupRecords)));
    }

    await updateMetadataTimestamp(providerId, metadata.urlAtLastFetch, metadata.metadataFetchedAt);

    const savedAlgorithms = algorithms;
    const savedParameters = parameters;
    const savedMetrics = metrics;
    useComputationCatalogStore.getState().setProviderAlgorithms(providerId, savedAlgorithms, savedParameters, savedMetrics);
    useComputationCatalogStore.getState().setProviderLayerSettingsSetup(providerId, setupRecords);
    useProviderLayerStore.getState().clearProviderLayers(providerId);

    for (const { algorithm, layers } of metadata.algorithms) {
        useProviderLayerStore.getState().setProviderLayers(
            providerId,
            algorithm.id,
            layers.map((l) => ({ ...l, providerId })),
        );
    }

    const envState = useEnvStore.getState();
    if (
        envState.computation.selectedProviderId === providerId
        && envState.computation.selectedAlgorithmId !== null
        && !validAlgorithmIds.has(envState.computation.selectedAlgorithmId)
    ) {
        envState.setComputation({
            ...envState.computation,
            selectedAlgorithmId: null,
        });
    }

    const envId = envState.env?.id;
    if (envId != null) {
        const parameterValues = await getAlgorithmParametersByEnvironment(envId);
        useParameterValuesStore.getState().setParameterValues(parameterValues);
        await loadLayerSettings(envId);
    }
}

// ─── Delete Provider ──────────────────────────────────────────────────────────

/**
 * Full provider deletion: cascades through all DB tables (layers,
 * layerSettingsSetup, layerSettings included) then syncs all in-memory stores.
 */
export async function deleteProviderWithCleanup(providerId: number): Promise<void> {
    await deleteComputationProvider(providerId);
    useComputationCatalogStore.getState().removeProvider(providerId);
    useProviderLayerStore.getState().clearProviderLayers(providerId);
    const envState = useEnvStore.getState();
    if (envState.computation.selectedProviderId === providerId) {
        envState.setComputation({
            ...envState.computation,
            selectedProviderId: null,
            selectedAlgorithmId: null,
        });
    }

    const envId = envState.env?.id;
    if (envId != null) {
        const parameterValues = await getAlgorithmParametersByEnvironment(envId);
        useParameterValuesStore.getState().setParameterValues(parameterValues);
        await loadLayerSettings(envId);
    }
}

// ─── Test Connection ──────────────────────────────────────────────────────────

/**
 * Verifies reachability of the provider. Does not modify the DB.
 * Expects any 2xx response from GET <url>/health.
 */
export async function testConnection(provider: ComputationProvider): Promise<TestConnectionResult> {
    const endpoint = buildComputationProviderEndpointUrl(provider.url, "health");
    if (!endpoint.ok) {
        return endpoint;
    }

    try {
        const response = await fetch(endpoint.url, {
            method: "GET",
            headers: buildHeaders(provider.apiKey),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            return {
                ok: false,
                error: "Provider returned an error response.",
                ...getHttpResponseDetails(response),
            };
        }

        if (isHtmlResponse(response)) {
            return {
                ok: false,
                error: "Service URL returned HTML instead of a provider health endpoint. Check that it points to the provider container, not this app.",
                ...getHttpResponseDetails(response),
            };
        }

        return {
            ok: true,
            ...getHttpResponseDetails(response),
        };
    } catch (err) {
        return { ok: false, error: getRequestErrorMessage(err, "Health check timed out after 10 seconds.") };
    }
}

// ─── Fetch Metadata ───────────────────────────────────────────────────────────

/**
 * Fetches algorithm metadata from GET <url>/metadata and saves it to DB.
 * Replaces all existing algorithms and parameters for this provider atomically.
 */
export async function fetchMetadata(provider: ComputationProvider): Promise<FetchMetadataResult> {
    if (!provider.id) {
        return { ok: false, error: "Provider must be saved before fetching metadata." };
    }

    const preview = await fetchMetadataPreview(provider);
    if (!preview.ok) {
        return preview;
    }

    try {
        await persistFetchedMetadata(provider.id, preview.metadata);
        return {
            ok: true,
            algorithmCount: preview.algorithmCount,
            statusCode: preview.statusCode,
            statusText: preview.statusText,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Metadata save failed: ${message}` };
    }
}
