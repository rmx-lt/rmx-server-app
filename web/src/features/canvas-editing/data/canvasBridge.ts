import { getLastEnvironmentId, saveEnvironment } from "@/data/local/environments";
import { saveComputationSelection } from "@/data/local/computationSelection";
import { saveAlgorithmParameters } from "@/data/local/computationAlgorithmParameters";
import { saveAllLayerSettings } from "@/data/local/layerSettings";
import { getObjectsByEnvironment, saveObjects, deleteObject } from "@/data/local/objects";
import { saveComputeResult, deleteComputeResult } from "@/data/local/computeResults";
import { deleteCoverageGridVisitCacheByEnvironment } from "@/data/local/coverageGridVisitCache";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import type { Object, Environment } from "@/data/local/schemaTypes";
import { useCanvasObjectStore } from "../stores/canvasObjectStore";
import { useEnvStore } from "@/model/envStore";
import { useParameterValuesStore } from "@/model/parameterValuesStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { useComputeResultStore } from "@/model/useComputeResultStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

// ── Count synchronization ──────────────────────────────────────────────────
// Reactively keeps envStore zone/obstacle counts derived from the canvas object
// list. Lives here (not in either store) to avoid a circular import.

function countByCategory(objects: Object[], category: string): number {
    return objects.filter((o) => o.category === category).length;
}

function syncEnvCounts(objects: Object[]): void {
    const zoneObjectCount = countByCategory(objects, OBJECT_CATEGORY.ZONE);
    const obstacleObjectCount = countByCategory(objects, OBJECT_CATEGORY.OBSTACLE);
    useEnvStore.setState((s) => ({ env: { ...s.env, zoneCount: zoneObjectCount, obstacleCount: obstacleObjectCount } }));
}

useCanvasObjectStore.subscribe((next, prev) => {
    if (next.objects !== prev.objects) syncEnvCounts(next.objects);
});

// ── ID counter ─────────────────────────────────────────────────────────────

/** Returns the next sequential environment ID (max existing + 1, or 1 when the table is empty). */
export async function resolveNextEnvironmentId(): Promise<number> {
    const max = await getLastEnvironmentId();
    return max + 1;
}

// ── Canvas save ────────────────────────────────────────────────────────────

let _isSaving = false;

async function persistDirtyObjects(dirtyObjects: Object[], deletedObjects: Object[]): Promise<void> {
    await Promise.all([
        dirtyObjects.length > 0 ? saveObjects(dirtyObjects) : Promise.resolve(),
        ...deletedObjects.map((obj) => deleteObject(obj)),
    ]);
}

/**
 * Persists all dirty canvas state and environment metadata to IndexedDB.
 * Returns true when data was actually written to IndexedDB, false when nothing
 * was dirty or a save was already in progress.
 */
export async function saveCanvas(): Promise<boolean> {
    if (_isSaving) return false;

    const { dirtyObjects, deletedObjects, clearDirty } =
        useCanvasObjectStore.getState();
    const { env, isEnvDirty, computation, clearDirty: clearEnvDirty } = useEnvStore.getState();
    const { parameterValues, isParameterValuesDirty, clearDirty: clearParamsDirty } = useParameterValuesStore.getState();
    const { layers, isLayerSettingsDirty, clearDirty: clearLayersDirty } = useLayerSettingsStore.getState();
    const { result, isComputeResultDirty, clearDirty: clearResultDirty } = useComputeResultStore.getState();
    const { isEnvPointsDirty, clearDirty: clearEnvPointsDirty } = useEnvPointStore.getState();
    const { isSystemGeoAnchorDirty, isEnvironmentGeoAnchorDirty, saveGeoAnchors } = useGeoAnchorStore.getState();

    if (!isEnvDirty && !isParameterValuesDirty && !isLayerSettingsDirty && !dirtyObjects.length && !deletedObjects.length && !isComputeResultDirty && !isEnvPointsDirty && !isSystemGeoAnchorDirty && !isEnvironmentGeoAnchorDirty) return false;

    _isSaving = true;
    try {
        await Promise.all([
            saveEnvironment(env),
            saveComputationSelection(computation),
            isParameterValuesDirty ? saveAlgorithmParameters(parameterValues) : Promise.resolve(),
            isLayerSettingsDirty ? saveAllLayerSettings(layers.flatMap((l) => l.settings)) : Promise.resolve(),
            persistDirtyObjects(dirtyObjects, deletedObjects),
            isComputeResultDirty
                ? (result !== null
                    ? saveComputeResult(result)
                    : Promise.all([
                        deleteComputeResult(env.id),
                        deleteCoverageGridVisitCacheByEnvironment(env.id),
                    ]).then(() => undefined))
                : Promise.resolve(),
            saveGeoAnchors(),
        ]);
        clearDirty();
        clearEnvDirty();
        clearParamsDirty();
        clearLayersDirty();
        clearResultDirty();
        clearEnvPointsDirty();
        return true;
    } finally {
        _isSaving = false;
    }
}

// ── Canvas load ────────────────────────────────────────────────────────────

/**
 * Loads objects for an environment from IndexedDB and hydrates the canvas store.
 */
export async function loadCanvasForEnvironment(env: Environment): Promise<void> {
    const objects = await getObjectsByEnvironment(env);
    useCanvasObjectStore.getState().setObjects(objects);
}
