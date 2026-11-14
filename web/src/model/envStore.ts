import { create } from "zustand";
import { COORD_SYSTEM, ENV_FORMAT, ENV_TYPE, type CoordSystemType, type EnvFormat, type EnvType } from "@/config/db-ops/enums";
import type { Environment } from "@/data/local/schemaTypes";
import { getSaveMode } from "@/model/saveModeStore";
import { saveEnvironment } from "@/data/local/environments";

/** Fills in fields that environments saved by earlier versions may lack. */
function normalizeEnvironment(env: Environment): Environment {
    const maybeHeadland = env as Environment & { headlandEnabled?: boolean; headlandWidth?: string };
    return {
        ...env,
        coordSystem: (env as Environment & { coordSystem?: string }).coordSystem ?? COORD_SYSTEM.CARTESIAN,
        headlandEnabled: maybeHeadland.headlandEnabled ?? true,
        headlandWidth: maybeHeadland.headlandWidth ?? "10",
    };
}

interface EnvState {
    env: Environment;
    /** True when env metadata has been changed since the last save or load. */
    isEnvDirty: boolean;
    /** Replaces the full environment record. Used by workspace bridge after load or init. Does not mark dirty. */
    setEnv: (env: Environment) => void;
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

function autosave(env: Environment): void {
    if (getSaveMode() === "autosave") {
        saveEnvironment(env).catch(console.error);
    }
}

function markEnvDirty(set: (fn: (state: EnvState) => Partial<EnvState>) => void, updater: (env: Environment) => Environment): void {
    set((state) => {
        const env = updater(normalizeEnvironment(state.env));
        autosave(env);
        return { env, isEnvDirty: true };
    });
}

export const useEnvStore = create<EnvState>()((set) => ({
    env: INITIAL_ENV,
    isEnvDirty: false,

    setEnv: (env) => set({ env: normalizeEnvironment(env) }),

    setName: (name) => markEnvDirty(set, (env) => ({ ...env, name })),

    setFormat: (format) => markEnvDirty(set, (env) => ({ ...env, format })),

    setType: (type) => markEnvDirty(set, (env) => ({ ...env, type })),

    setCoordSystem: (coordSystem) => markEnvDirty(set, (env) => ({ ...env, coordSystem })),

    setHeadlandEnabled: (enabled) => markEnvDirty(set, (env) => ({ ...env, headlandEnabled: enabled })),

    setHeadlandWidth: (width) => markEnvDirty(set, (env) => ({ ...env, headlandWidth: width })),

    clearDirty: () => set({ isEnvDirty: false }),
}));
