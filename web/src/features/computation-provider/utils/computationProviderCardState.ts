import type {
    ComputationAlgorithmDetails,
    ComputationProvider,
    FetchedComputationMetadata,
} from "@/data/local/serviceTypes";

export type ComputationProviderForm = Omit<ComputationProvider, "id">;

export const EMPTY_COMPUTATION_PROVIDER_FORM: ComputationProviderForm = {
    name: "",
    url: "",
    apiKey: "",
    metadataFetchedAt: null,
    urlAtLastFetch: null,
};

export function normalizeComputationProviderForm(form: ComputationProviderForm): ComputationProviderForm {
    return {
        ...form,
        name: form.name.trim(),
        url: form.url.trim(),
    };
}

export function toComputationProviderFormState(
    provider: ComputationProviderForm | ComputationProvider,
): ComputationProviderForm {
    return normalizeComputationProviderForm({
        name: provider.name,
        url: provider.url,
        apiKey: provider.apiKey,
        metadataFetchedAt: provider.metadataFetchedAt,
        urlAtLastFetch: provider.urlAtLastFetch,
    });
}

export function areComputationProviderFormsEqual(
    left: ComputationProviderForm,
    right: ComputationProviderForm,
) {
    return left.name === right.name
        && left.url === right.url
        && left.apiKey === right.apiKey
        && left.metadataFetchedAt === right.metadataFetchedAt
        && left.urlAtLastFetch === right.urlAtLastFetch;
}

export function areComputationAlgorithmDetailsEqual(
    left: ComputationAlgorithmDetails[],
    right: ComputationAlgorithmDetails[],
) {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((leftDetails, index) => {
        const rightDetails = right[index];
        if (!rightDetails) {
            return false;
        }

        const sameAlgorithm = leftDetails.algorithm.id === rightDetails.algorithm.id
            && leftDetails.algorithm.name === rightDetails.algorithm.name;

        if (!sameAlgorithm || leftDetails.parameters.length !== rightDetails.parameters.length) {
            return false;
        }

        return leftDetails.parameters.every((leftParam, paramIndex) => {
            const rightParam = rightDetails.parameters[paramIndex];
            if (!rightParam) {
                return false;
            }

            return leftParam.id === rightParam.id
                && leftParam.algorithmId === rightParam.algorithmId
                && leftParam.name === rightParam.name
                && leftParam.section === rightParam.section
                && leftParam.paramType === rightParam.paramType
                && leftParam.appHandler === rightParam.appHandler
                && leftParam.defaultValue === rightParam.defaultValue
                && leftParam.enumValues.length === rightParam.enumValues.length
                && leftParam.enumValues.every((value, enumIndex) => value === rightParam.enumValues[enumIndex]);
        });
    });
}

export function areFetchedComputationMetadataEqual(
    left: FetchedComputationMetadata | null,
    right: FetchedComputationMetadata | null,
) {
    if (left === right) {
        return true;
    }

    if (!left || !right) {
        return false;
    }

    return left.metadataFetchedAt === right.metadataFetchedAt
        && left.urlAtLastFetch === right.urlAtLastFetch
        && areComputationAlgorithmDetailsEqual(left.algorithms, right.algorithms);
}

export function sleep(ms: number) {
    return new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

export async function withMinimumLoadingTime<T>(
    operation: () => Promise<T>,
    minDurationMs: number,
) {
    const startedAt = performance.now();

    try {
        return await operation();
    } finally {
        const elapsedMs = performance.now() - startedAt;
        const remainingMs = minDurationMs - elapsedMs;

        if (remainingMs > 0) {
            await sleep(remainingMs);
        }
    }
}
