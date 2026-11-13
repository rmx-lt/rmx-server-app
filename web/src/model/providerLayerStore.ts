import { create } from "zustand";
import type { ProviderLayerRecord } from "@/data/local/serviceTypes";

interface ProviderLayerState {
    layers: ProviderLayerRecord[];
    setProviderLayers: (providerId: number, algorithmId: number, layers: ProviderLayerRecord[]) => void;
    clearProviderLayers: (providerId: number) => void;
}

export const useProviderLayerStore = create<ProviderLayerState>((set) => ({
    layers: [],

    setProviderLayers: (providerId, algorithmId, layers) => {
        set((state) => ({
            layers: [
                ...state.layers.filter(
                    (l) => !(l.providerId === providerId && l.algorithmId === algorithmId),
                ),
                ...layers,
            ],
        }));
    },

    clearProviderLayers: (providerId) => {
        set((state) => ({
            layers: state.layers.filter((l) => l.providerId !== providerId),
        }));
    },
}));
