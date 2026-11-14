import { create } from "zustand";
import { loadLayerSettingViews, saveAllLayerSettings } from "@/data/local/layerSettings";
import { getAllLayers } from "@/data/local/layers";
import { getSaveMode } from "@/model/saveModeStore";
import type { LayerPK, LayerRecord, LayerSettingView, LayerWithSettings } from "@/data/local/layerTypes";
import { LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";

interface LayerSettingsState {
    layers: LayerWithSettings[];
    /** True when layer settings have been changed since the last save or load. */
    isLayerSettingsDirty: boolean;
    /** Replaces all layer data. Used by workspace bridge after load or init. Does not mark dirty. */
    setLayers: (layers: LayerWithSettings[]) => void;
    setVisible: (pk: LayerPK, visible: boolean) => void;
    setParam: (layerKey: number, name: string, value: string) => void;
    swapZIndex: (pkA: LayerPK, pkB: LayerPK) => void;
    /**
     * Reassigns Z-Index values based on display order. `orderedPKs` lists
     * layer PKs from top (highest z) to bottom (lowest z). Each layer gets
     * z = (n - 1 - position) * 10.
     */
    reorderLayers: (orderedPKs: LayerPK[]) => void;
    /** Clears the dirty flag. Called by canvas bridge after a successful save. */
    clearDirty: () => void;
}

function getAllParams(layers: LayerWithSettings[]): LayerSettingView[] {
    return layers.flatMap((l) => l.settings);
}

function autosave(layers: LayerWithSettings[]): void {
    if (getSaveMode() === "autosave") {
        saveAllLayerSettings(getAllParams(layers)).catch(console.error);
    }
}

function layerPKMatches(layer: LayerRecord, pk: LayerPK): boolean {
    return layer.id === pk.id && layer.algorithmId === pk.algorithmId && layer.providerId === pk.providerId;
}

function updateParam(
    layers: LayerWithSettings[],
    pk: LayerPK,
    key: string,
    value: string,
): LayerWithSettings[] {
    return layers.map((l) => {
        if (!layerPKMatches(l.layer, pk)) return l;
        return { ...l, settings: l.settings.map((p) => (p.key === key ? { ...p, value } : p)) };
    });
}

function paramValue(settings: LayerSettingView[], key: string): string | undefined {
    return settings.find((p) => p.key === key)?.value;
}

export const useLayerSettingsStore = create<LayerSettingsState>()((set) => ({
    layers: [],
    isLayerSettingsDirty: false,

    setLayers: (layers) => set({ layers, isLayerSettingsDirty: false }),

    setVisible: (pk, visible) => {
        set((state) => {
            const item = state.layers.find((l) => layerPKMatches(l.layer, pk));
            if (!item || paramValue(item.settings, LAYER_PARAM_KEY.VISIBLE) === String(visible)) return {};
            const layers = updateParam(state.layers, pk, LAYER_PARAM_KEY.VISIBLE, String(visible));
            autosave(layers);
            return { layers, isLayerSettingsDirty: true };
        });
    },

    setParam: (layerKey, name, value) => {
        set((state) => {
            const item = state.layers.find((l) => l.layer.id === layerKey);
            if (!item || paramValue(item.settings, name) === value) return {};
            const layers = state.layers.map((l) => {
                if (l.layer.id !== layerKey) return l;
                return { ...l, settings: l.settings.map((p) => (p.key === name ? { ...p, value } : p)) };
            });
            autosave(layers);
            return { layers, isLayerSettingsDirty: true };
        });
    },

    swapZIndex: (pkA, pkB) => {
        set((state) => {
            const a = state.layers.find((l) => layerPKMatches(l.layer, pkA));
            const b = state.layers.find((l) => layerPKMatches(l.layer, pkB));
            if (!a || !b) return {};
            const zA = paramValue(a.settings, LAYER_PARAM_KEY.Z_INDEX) ?? "0";
            const zB = paramValue(b.settings, LAYER_PARAM_KEY.Z_INDEX) ?? "0";
            let layers = updateParam(state.layers, pkA, LAYER_PARAM_KEY.Z_INDEX, zB);
            layers = updateParam(layers, pkB, LAYER_PARAM_KEY.Z_INDEX, zA);
            autosave(layers);
            return { layers, isLayerSettingsDirty: true };
        });
    },

    reorderLayers: (orderedPKs) => {
        set((state) => {
            const n = orderedPKs.length;
            let layers = state.layers;
            orderedPKs.forEach((pk, idx) => {
                layers = updateParam(layers, pk, "Z-Index", String((n - 1 - idx) * 10));
            });
            autosave(layers);
            return { layers, isLayerSettingsDirty: true };
        });
    },

    clearDirty: () => set({ isLayerSettingsDirty: false }),
}));

export async function loadLayerSettings(environmentId: number): Promise<void> {
    const [allLayers, allViews] = await Promise.all([
        getAllLayers(),
        loadLayerSettingViews(environmentId),
    ]);
    const viewsByKey = new Map<string, LayerSettingView[]>();
    for (const view of allViews) {
        const key = `${view.layerId}:${view.algorithmId}:${view.providerId}`;
        const list = viewsByKey.get(key) ?? [];
        list.push(view);
        viewsByKey.set(key, list);
    }
    const layers: LayerWithSettings[] = allLayers.map((layer) => ({
        layer,
        settings: viewsByKey.get(`${layer.id}:${layer.algorithmId}:${layer.providerId}`) ?? [],
    }));
    useLayerSettingsStore.getState().setLayers(layers);
}

export function getLayerParam(layers: LayerWithSettings[], layerKey: number, key: string): string | undefined {
    return layers.find((l) => l.layer.id === layerKey)?.settings.find((p) => p.key === key)?.value;
}
