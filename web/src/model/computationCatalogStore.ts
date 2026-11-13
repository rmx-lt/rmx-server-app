import { create } from "zustand";
import { getAllComputationProviders } from "@/data/local/computationProviders";
import { getAllComputationAlgorithms } from "@/data/local/computationProviderAlgorithms";
import { getAllAlgorithmParameters } from "@/data/local/computationAlgorithmParametersSetup";
import { getAllAlgorithmMetrics } from "@/data/local/computationAlgorithmMetricsSetup";
import { getAllAppEnums } from "@/data/local/appEnumSetup";
import { getAllLayers } from "@/data/local/layers";
import { getAllLayerSettingsSetup } from "@/data/local/layerSettingsSetup";
import { useProviderLayerStore } from "@/model/providerLayerStore";
import type { AlgorithmMetric, AlgorithmParameter, AppEnumValue, ComputationAlgorithm, ComputationProvider, ProviderLayerRecord } from "@/data/local/serviceTypes";
import type { LayerSettingsSetup } from "@/data/local/layerTypes";

interface ComputationCatalogState {
    providers: ComputationProvider[];
    algorithms: ComputationAlgorithm[];
    parameters: AlgorithmParameter[];
    metrics: AlgorithmMetric[];
    appEnums: AppEnumValue[];
    layerSettingsSetup: LayerSettingsSetup[];

    setCatalog: (
        providers: ComputationProvider[],
        algorithms: ComputationAlgorithm[],
        parameters: AlgorithmParameter[],
        appEnums: AppEnumValue[],
        layerSettingsSetup: LayerSettingsSetup[],
        metrics: AlgorithmMetric[],
    ) => void;

    setProviderAlgorithms: (
        providerId: number,
        algorithms: ComputationAlgorithm[],
        parameters: AlgorithmParameter[],
        metrics: AlgorithmMetric[],
    ) => void;

    upsertProvider: (provider: ComputationProvider) => void;

    removeProvider: (providerId: number) => void;

    upsertAlgorithm: (algorithm: ComputationAlgorithm) => void;

    removeAlgorithm: (id: number, computationProviderId: number) => void;
    /** Replaces in-memory layerSettingsSetup entries for a given provider after a metadata fetch. */
    setProviderLayerSettingsSetup: (providerId: number, setups: LayerSettingsSetup[]) => void;
}

export const useComputationCatalogStore = create<ComputationCatalogState>((set) => ({
    providers: [],
    algorithms: [],
    parameters: [],
    metrics: [],
    appEnums: [],
    layerSettingsSetup: [],

    setCatalog: (providers, algorithms, parameters, appEnums, layerSettingsSetup, metrics) => {
        set({ providers, algorithms, parameters, appEnums, layerSettingsSetup, metrics });
    },

    setProviderAlgorithms: (providerId, algorithms, parameters, metrics) => {
        set((state) => ({
            algorithms: [
                ...state.algorithms.filter((a) => a.computationProviderId !== providerId),
                ...algorithms,
            ],
            parameters: [
                ...state.parameters.filter((p) => p.computationProviderId !== providerId),
                ...parameters,
            ],
            metrics: [
                ...state.metrics.filter((m) => m.computationProviderId !== providerId),
                ...metrics,
            ],
        }));
    },

    upsertProvider: (provider) => {
        set((state) => {
            const exists = state.providers.some((p) => p.id === provider.id);
            return {
                providers: exists
                    ? state.providers.map((p) => (p.id === provider.id ? provider : p))
                    : [...state.providers, provider],
            };
        });
    },

    removeProvider: (providerId) => {
        set((state) => ({
            providers: state.providers.filter((p) => p.id !== providerId),
            algorithms: state.algorithms.filter((a) => a.computationProviderId !== providerId),
            parameters: state.parameters.filter((p) => p.computationProviderId !== providerId),
            metrics: state.metrics.filter((m) => m.computationProviderId !== providerId),
            layerSettingsSetup: state.layerSettingsSetup.filter((s) => s.providerId !== providerId),
        }));
    },

    upsertAlgorithm: (algorithm) => {
        set((state) => {
            const exists = state.algorithms.some(
                (a) => a.id === algorithm.id && a.computationProviderId === algorithm.computationProviderId,
            );
            return {
                algorithms: exists
                    ? state.algorithms.map((a) =>
                        a.id === algorithm.id && a.computationProviderId === algorithm.computationProviderId
                            ? algorithm
                            : a,
                    )
                    : [...state.algorithms, algorithm],
            };
        });
    },

    removeAlgorithm: (id, computationProviderId) => {
        set((state) => ({
            algorithms: state.algorithms.filter(
                (a) => !(a.id === id && a.computationProviderId === computationProviderId),
            ),
            parameters: state.parameters.filter(
                (p) => !(p.algorithmId === id && p.computationProviderId === computationProviderId),
            ),
            metrics: state.metrics.filter(
                (m) => !(m.algorithmId === id && m.computationProviderId === computationProviderId),
            ),
        }));
    },

    setProviderLayerSettingsSetup: (providerId, setups) => {
        set((state) => ({
            layerSettingsSetup: [
                ...state.layerSettingsSetup.filter((s) => s.providerId !== providerId),
                ...setups,
            ],
        }));
    },
}));

export async function loadComputationCatalog(): Promise<void> {
    const [providers, algorithms, parameters, appEnums, layerSettingsSetupData, allLayers, metrics] = await Promise.all([
        getAllComputationProviders(),
        getAllComputationAlgorithms(),
        getAllAlgorithmParameters(),
        getAllAppEnums(),
        getAllLayerSettingsSetup(),
        getAllLayers(),
        getAllAlgorithmMetrics(),
    ]);
    useComputationCatalogStore.getState().setCatalog(providers, algorithms, parameters, appEnums, layerSettingsSetupData, metrics);

    // Hydrate providerLayerStore from persisted layers records.
    // System layers have algorithmId === 0 and are skipped.
    const providerLayersByAlgorithm = new Map<string, ProviderLayerRecord[]>();
    for (const layer of allLayers) {
        if (!layer.algorithmId || !layer.providerId) continue;
        const key = `${layer.providerId}-${layer.algorithmId}`;
        const stub: ProviderLayerRecord = {
            id: layer.id,
            algorithmId: layer.algorithmId,
            providerId: layer.providerId,
            computeLayer: layer.computeLayer ?? layer.label,
            name: layer.label,
            layerType: (layer.type as ProviderLayerRecord["layerType"]) ?? "Polygon",
            generalStyleAttributes: [],
            pointStyleAttributes: [],
            lineStyleAttributes: [],
            polygonStyleAttributes: [],
            pointLabelColorMapping: [],
            pointLabelEnumValues: [],
        };
        const group = providerLayersByAlgorithm.get(key);
        if (group) group.push(stub);
        else providerLayersByAlgorithm.set(key, [stub]);
    }
    for (const layers of providerLayersByAlgorithm.values()) {
        const first = layers[0];
        if (first) {
            useProviderLayerStore.getState().setProviderLayers(first.providerId, first.algorithmId, layers);
        }
    }
}
