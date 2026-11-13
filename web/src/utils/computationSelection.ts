import { COORD_SYSTEM } from "@/config/db-ops/enums";
import type { Environment, ComputationSelection } from "@/data/local/schemaTypes";

export function createEmptyComputationSelection(environmentId: number): ComputationSelection {
    return {
        environmentId,
        selectedProviderId: null,
        selectedAlgorithmId: null,
    };
}

export function normalizeComputationSelection(
    computation: Partial<ComputationSelection> & { environmentId: number },
): ComputationSelection {
    return {
        environmentId: computation.environmentId,
        selectedProviderId: typeof computation.selectedProviderId === "number" ? computation.selectedProviderId : null,
        selectedAlgorithmId: typeof computation.selectedAlgorithmId === "number" ? computation.selectedAlgorithmId : null,
    };
}

export function normalizeEnvironment(env: Environment): Environment {
    const maybeHeadland = env as Environment & { headlandEnabled?: boolean; headlandWidth?: string };
    return {
        ...env,
        coordSystem: (env as Environment & { coordSystem?: string }).coordSystem ?? COORD_SYSTEM.CARTESIAN,
        headlandEnabled: maybeHeadland.headlandEnabled ?? true,
        headlandWidth: maybeHeadland.headlandWidth ?? "10",
    };
}
