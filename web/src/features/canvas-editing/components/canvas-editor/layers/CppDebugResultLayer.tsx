import { Fragment, memo } from "react";
import { useCppDebugStore } from "@/features/coverage-planning/stores/cppDebugStore";
import { useProviderLayerStore } from "@/model/providerLayerStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { extractLayerData } from "@/features/canvas-editing/utils/layerDataUtils";
import { CanvasDynamicLayer } from "./CanvasDynamicLayer";

function CppDebugResultLayerInner() {
    const isDebugMode = useCppDebugStore((s) => s.isDebugMode);
    const currentResult = useCppDebugStore((s) => s.currentResult);
    const sessionAlgorithmId = useCppDebugStore((s) => s.sessionAlgorithmId);
    const sessionProviderId = useCppDebugStore((s) => s.sessionProviderId);

    const providerLayers = useProviderLayerStore((s) => s.layers);
    const layerSettings = useLayerSettingsStore((s) => s.layers);

    if (!isDebugMode || !currentResult || sessionAlgorithmId === null || sessionProviderId === null) {
        return null;
    }

    const activeLayers = providerLayers.filter(
        (l) => l.algorithmId === sessionAlgorithmId && l.providerId === sessionProviderId,
    );

    if (activeLayers.length === 0) return null;

    return (
        <Fragment>
            {activeLayers.map((pl) => {
                const lws = layerSettings.find(
                    (l) =>
                        l.layer.id === pl.id &&
                        l.layer.algorithmId === pl.algorithmId &&
                        l.layer.providerId === pl.providerId,
                );
                const items = extractLayerData(currentResult, pl.computeLayer);
                return (
                    <CanvasDynamicLayer
                        key={`dbg-${pl.algorithmId}-${pl.providerId}-${pl.id}`}
                        layerMeta={pl}
                        settings={lws?.settings ?? []}
                        items={items}
                    />
                );
            })}
        </Fragment>
    );
}

export const CppDebugResultLayer = memo(CppDebugResultLayerInner);

