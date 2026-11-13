import { create } from "zustand";
import type { ComputationAlgorithmParameter } from "@/data/local/schemaTypes";
import { getSaveMode } from "@/model/saveModeStore";
import { saveAlgorithmParameters } from "@/data/local/computationAlgorithmParameters";

interface ParameterValuesState {
    parameterValues: ComputationAlgorithmParameter[];
    /** True when parameter values have been changed since the last save or load. */
    isParameterValuesDirty: boolean;
    /** Replaces the full parameter values array. Used by workspace bridge after load or init. Does not mark dirty. */
    setParameterValues: (values: ComputationAlgorithmParameter[]) => void;
    /** Upserts a single parameter value and marks dirty. Triggers autosave when mode is "autosave". */
    setParameterValue: (id: number, algorithmId: number, providerId: number, environmentId: number, value: string) => void;
    /** Clears the dirty flag. Called by canvas bridge after a successful save. */
    clearDirty: () => void;
}

function autosave(values: ComputationAlgorithmParameter[]): void {
    if (getSaveMode() === "autosave") {
        saveAlgorithmParameters(values).catch(console.error);
    }
}

export const useParameterValuesStore = create<ParameterValuesState>()((set) => ({
    parameterValues: [],
    isParameterValuesDirty: false,

    setParameterValues: (values) => set({ parameterValues: values, isParameterValuesDirty: false }),

    setParameterValue: (id, algorithmId, providerId, environmentId, value) => {
        set((state) => {
            const existing = state.parameterValues.find((pv) => pv.id === id && pv.algorithmId === algorithmId && pv.providerId === providerId && pv.environmentId === environmentId);

            if (existing !== undefined && existing.value === value) {
                return {};
            }

            const nextValues = existing !== undefined
                ? state.parameterValues.map((pv) =>
                    pv.id === id && pv.algorithmId === algorithmId && pv.providerId === providerId && pv.environmentId === environmentId
                        ? { ...pv, value }
                        : pv,
                )
                : [...state.parameterValues, { id, algorithmId, providerId, environmentId, value }];

            autosave(nextValues);
            return { parameterValues: nextValues, isParameterValuesDirty: true };
        });
    },

    clearDirty: () => set({ isParameterValuesDirty: false }),
}));
