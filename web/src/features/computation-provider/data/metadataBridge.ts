import { isSupportedAppParameterHandler } from "@/config/computation/appParameterHandlers";
import {
    isSupportedLayerType,
    isSupportedStyleAttributeKey,
    isSupportedStyleType,
} from "@/config/computation/supportedLayerAttributes";
import type {
    MetadataResponse,
    MetadataLayerResponse,
    ProviderLayerRecord,
    ComputationAlgorithmDetails,
    MetadataValidationFailure,
    AlgorithmMetric,
} from "@/data/local/serviceTypes";

export type MetadataIngestResult =
    | { ok: true; algorithms: ComputationAlgorithmDetails[] }
    | MetadataValidationFailure;

export function validateProviderMetadata(response: MetadataResponse): { ok: true } | MetadataValidationFailure {
    const unsupportedHandlers = new Set<string>();
    const unsupportedAttributes = new Set<string>();

    for (const algorithm of response.algorithms) {
        for (const parameter of algorithm.parameters) {
            if (parameter.appHandler && !isSupportedAppParameterHandler(parameter.appHandler)) {
                unsupportedHandlers.add(parameter.appHandler);
            }
        }

        for (const layer of algorithm.layers) {
            if (!isSupportedLayerType(layer.layerType)) {
                unsupportedAttributes.add(`layerType:"${layer.layerType}"`);
            }

            const allAttrs = [
                ...layer.style.generalStyleAttributes,
                ...(layer.style.pointStyleAttributes ?? []),
                ...(layer.style.lineStyleAttributes ?? []),
                ...(layer.style.polygonStyleAttributes ?? []),
            ];

            for (const attr of allAttrs) {
                if (!isSupportedStyleAttributeKey(attr.key)) {
                    unsupportedAttributes.add(`key:"${attr.key}"`);
                }
                if (!isSupportedStyleType(attr.styleType)) {
                    unsupportedAttributes.add(`styleType:"${attr.styleType}"`);
                }
            }
        }
    }

    if (unsupportedHandlers.size > 0) {
        const sorted = [...unsupportedHandlers].sort();
        return {
            ok: false,
            errorCode: "unsupported_app_handler",
            unsupportedHandlers: sorted,
            error: `Unsupported app handler(s): ${sorted.join(", ")}.`,
        };
    }

    if (unsupportedAttributes.size > 0) {
        const sorted = [...unsupportedAttributes].sort();
        return {
            ok: false,
            errorCode: "unsupported_layer_attribute",
            unsupportedAttributes: sorted,
            error: `Unsupported layer attribute(s): ${sorted.join(", ")}.`,
        };
    }

    return { ok: true };
}

export function buildProviderLayers(
    algorithmId: number,
    providerId: number,
    layers: MetadataLayerResponse[],
): ProviderLayerRecord[] {
    return layers.map((layer) => ({
        id: layer.id,
        algorithmId,
        providerId,
        computeLayer: layer.computeLayer,
        name: layer.name,
        layerType: layer.layerType,
        generalStyleAttributes: layer.style.generalStyleAttributes,
        pointStyleAttributes: layer.style.pointStyleAttributes ?? [],
        lineStyleAttributes: layer.style.lineStyleAttributes ?? [],
        polygonStyleAttributes: layer.style.polygonStyleAttributes ?? [],
        pointLabelColorMapping: layer.style.pointLabelColorMapping ?? [],
        pointLabelEnumValues: layer.pointLabelEnumValues ?? [],
    }));
}

export function ingestProviderMetadata(
    providerId: number,
    response: MetadataResponse,
): MetadataIngestResult {
    const validation = validateProviderMetadata(response);
    if (!validation.ok) {
        return validation;
    }

    const algorithms: ComputationAlgorithmDetails[] = response.algorithms.map((algorithmResponse) => {
        const algorithmId = algorithmResponse.id;
        return {
            algorithm: {
                id: algorithmId,
                computationProviderId: providerId,
                name: algorithmResponse.name,
            },
            parameters: algorithmResponse.parameters.map((p) => ({
                unitType: p.unitType,
                id: p.id,
                algorithmId,
                computationProviderId: providerId,
                name: p.name,
                paramType: p.paramType,
                enumValues: p.enumValues ?? [],
                defaultValue: p.defaultValue ?? "",
                minValue: p.minValue,
                maxValue: p.maxValue,
                section: p.section,
                appHandler: p.appHandler ?? null,
            })),
            layers: buildProviderLayers(algorithmId, providerId, algorithmResponse.layers),
            metrics: (algorithmResponse.metrics ?? []).map((m): AlgorithmMetric => ({
                id: m.id,
                algorithmId,
                computationProviderId: providerId,
                name: m.name,
                type: m.type,
                group: m.group,
                style: m.style,
                benchmark: m.benchmark,
            })),
        };
    });

    return { ok: true, algorithms };
}
