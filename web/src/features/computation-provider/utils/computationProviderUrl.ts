const ABSOLUTE_SERVICE_URL_MESSAGE = "Enter an absolute http:// or https:// URL, for example http://localhost:8080.";

export type ComputationProviderUrlValidationResult =
    | { ok: true; baseUrl: string }
    | { ok: false; error: string };

export function validateComputationProviderUrl(rawUrl: string): ComputationProviderUrlValidationResult {
    const trimmedUrl = rawUrl.trim();

    if (trimmedUrl === "") {
        return { ok: false, error: "Service URL is required." };
    }

    let parsedUrl: URL;

    try {
        parsedUrl = new URL(trimmedUrl);
    } catch {
        return { ok: false, error: ABSOLUTE_SERVICE_URL_MESSAGE };
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return { ok: false, error: ABSOLUTE_SERVICE_URL_MESSAGE };
    }

    if (parsedUrl.search !== "" || parsedUrl.hash !== "") {
        return { ok: false, error: "Service URL must not include a query string or fragment." };
    }

    return {
        ok: true,
        baseUrl: parsedUrl.href.replace(/\/+$/, ""),
    };
}

export function buildComputationProviderEndpointUrl(
    rawUrl: string,
    endpoint: string,
):
    | { ok: true; url: string; baseUrl: string }
    | { ok: false; error: string } {
    const validation = validateComputationProviderUrl(rawUrl);
    if (!validation.ok) {
        return validation;
    }

    const normalizedEndpoint = endpoint.replace(/^\/+/, "");

    return {
        ok: true,
        baseUrl: validation.baseUrl,
        url: `${validation.baseUrl}/${normalizedEndpoint}`,
    };
}
