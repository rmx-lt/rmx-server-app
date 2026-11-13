import { create } from "zustand";
import { COORD_SYSTEM, ENV_FORMAT, ENV_TYPE, type CoordSystemType, type EnvFormat, type EnvType } from "@/config/db-ops/enums";
import type { Environment, ComputationSelection } from "@/data/local/schemaTypes";
import { getSaveMode } from "@/model/saveModeStore";
import { saveEnvironment } from "@/data/local/environments";
import { saveComputationSelection } from "@/data/local/computationSelection";
import {
    createEmptyComputationSelection,
    normalizeEnvironment,
    normalizeComputationSelection,
} from "@/utils/computationSelection";

interface EnvState {
    env: Environment;
    computation: ComputationSelection;
    /** True when env metadata or computation selection has been changed since the last save or load. */
    isEnvDirty: boolean;
    /** Replaces the full environment record. Used by workspace bridge after load or init. Does not mark dirty. */
    setEnv: (env: Environment) => void;
    /** Replaces the computation selection. Used by workspace bridge after load or init. Does not mark dirty. */
    setComputation: (computation: ComputationSelection) => void;
    /** Updates the environment name and marks the record as dirty. Triggers autosave when mode is "autosave". */
    setName: (name: string) => void;
    /** Updates the environment format and marks the record as dirty. Triggers autosave when mode is "autosave". */
    setFormat: (format: EnvFormat) => void;
    /** Updates the environment type and marks the record as dirty. Triggers autosave when mode is "autosave". */
    setType: (type: EnvType) => void;
    /** Updates the environment coordinate system and marks the record as dirty. Triggers autosave when mode is "autosave". */
    setCoordSystem: (coordSystem: CoordSystemType) => void;
    /** Updates system headland enabled flag on the environment and marks dirty. */
    setHeadlandEnabled: (enabled: boolean) => void;
    /** Updates system headland width on the environment and marks dirty. */
    setHeadlandWidth: (width: string) => void;
    /** Updates the active computation provider and clears the active algorithm selection. */
    setComputationProviderId: (providerId: number | null) => void;
    /** Updates the active computation algorithm within the selected provider. */
    setComputationAlgorithmId: (algorithmId: number | null) => void;
    /** Clears the dirty flag. Called by canvas bridge after a successful save. */
    clearDirty: () => void;
}

const INITIAL_ENV: Environment = {
    id: 0,
    name: "Untitled Environment",
    format: ENV_FORMAT.POLYGON,
    type: ENV_TYPE.ANY_OFFLINE,
    coordSystem: COORD_SYSTEM.CARTESIAN,
    headlandEnabled: true,
    headlandWidth: "10",
    zoneCount: 0,
    obstacleCount: 0,
};

const INITIAL_COMPUTATION: ComputationSelection = createEmptyComputationSelection(0);

function autosave(env: Environment, computation: ComputationSelection): void {
    if (getSaveMode() === "autosave") {
        saveEnvironment(env).catch(console.error);
        saveComputationSelection(computation).catch(console.error);
    }
}

function markEnvDirty(set: (fn: (state: EnvState) => Partial<EnvState>) => void, updater: (env: Environment) => Environment): void {
    set((state) => {
        const env = updater(normalizeEnvironment(state.env));
        autosave(env, state.computation);
        return { env, isEnvDirty: true };
    });
}

export const useEnvStore = create<EnvState>()((set) => ({
    env: INITIAL_ENV,
    computation: INITIAL_COMPUTATION,
    isEnvDirty: false,

    setEnv: (env) => set({ env: normalizeEnvironment(env) }),

    setComputation: (computation) => set({ computation: normalizeComputationSelection(computation) }),

    setName: (name) => markEnvDirty(set, (env) => ({ ...env, name })),

    setFormat: (format) => markEnvDirty(set, (env) => ({ ...env, format })),

    setType: (type) => markEnvDirty(set, (env) => ({ ...env, type })),

    setCoordSystem: (coordSystem) => markEnvDirty(set, (env) => ({ ...env, coordSystem })),

    setHeadlandEnabled: (enabled) => markEnvDirty(set, (env) => ({ ...env, headlandEnabled: enabled })),

    setHeadlandWidth: (width) => markEnvDirty(set, (env) => ({ ...env, headlandWidth: width })),

    setComputationProviderId: (providerId) => {
        set((state) => {
            const computation = normalizeComputationSelection(state.computation);

            if (computation.selectedProviderId === providerId) {
                return {};
            }

            const nextComputation: ComputationSelection = {
                ...computation,
                selectedProviderId: providerId,
                selectedAlgorithmId: null,
            };

            autosave(state.env, nextComputation);
            return { computation: nextComputation, isEnvDirty: true };
        });
    },

    setComputationAlgorithmId: (algorithmId) => {
        set((state) => {
            const computation = normalizeComputationSelection(state.computation);

            if (computation.selectedAlgorithmId === algorithmId) {
                return {};
            }

            const nextComputation: ComputationSelection = {
                ...computation,
                selectedAlgorithmId: algorithmId,
            };

            autosave(state.env, nextComputation);
            return { computation: nextComputation, isEnvDirty: true };
        });
    },

    clearDirty: () => set({ isEnvDirty: false }),
}));
