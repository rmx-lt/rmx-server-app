import { getEnvironment, saveEnvironment } from "@/data/local/environments";
import { getComputationSelection, saveComputationSelection } from "@/data/local/computationSelection";
import { getAlgorithmParametersByEnvironment, saveAlgorithmParameters } from "@/data/local/computationAlgorithmParameters";
import { deleteObjectsByEnvironment, saveObjects } from "@/data/local/objects";
import { COORD_SYSTEM, ENV_FORMAT, ENV_TYPE, OBJECT_CATEGORY } from "@/config/db-ops/enums";
import type { Environment } from "@/data/local/schemaTypes";
import type { ImportedWorkspaceData } from "@/features/workspace-manager/utils/importWorkspace";
import { useEnvStore } from "@/model/envStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useSaveModeStore } from "@/model/saveModeStore";
import { useParameterValuesStore } from "@/model/parameterValuesStore";
import { loadComputationCatalog } from "@/model/computationCatalogStore";
import { loadLayerSettings } from "@/model/layerSettingsStore";
import { addMissingLayerSettingsForEnvironment, initLayerSettingsForEnvironment } from "@/data/local/layerSettings";
import { getAllLayerSettingsSetup } from "@/data/local/layerSettingsSetup";
import { getComputeResult } from "@/data/local/computeResults";
import { deleteEnvPointsByEnvironment, upsertEnvPoint } from "@/data/local/envPoints";
import { initEnvironmentGeoAnchorFromSystem, setEnvironmentGeoAnchor as persistEnvironmentGeoAnchor } from "@/data/local/environmentGeoAnchor";
import { useComputeResultStore } from "@/model/useComputeResultStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { resolveNextEnvironmentId, loadCanvasForEnvironment, saveCanvas } from "@/features/canvas-editing/data/canvasBridge";
import { createEmptyComputationSelection } from "@/utils/computationSelection";

const BLANK_ENV: Omit<Environment, "id"> = {
    name: "Untitled Environment",
    format: ENV_FORMAT.POLYGON,
    type: ENV_TYPE.ANY_OFFLINE,
    coordSystem: COORD_SYSTEM.CARTESIAN,
    headlandEnabled: true,
    headlandWidth: "10",
    zoneCount: 0,
    obstacleCount: 0,
};

function countByCategory(objects: { category: string }[], category: string): number {
    return objects.filter((o) => o.category === category).length;
}

function modeAfterFirstSave(): "manual" | "autosave" {
    return useSaveModeStore.getState().isAutoSaveEnabled ? "autosave" : "manual";
}

function isDefined<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

/** Initializes a fresh blank environment at app startup. Seeds the ID counter from IndexedDB. */
export async function initializeWorkspace(): Promise<void> {
    const nextId = await resolveNextEnvironmentId();
    const env = { ...BLANK_ENV, id: nextId };
    useEnvStore.getState().setEnv(env);
    useEnvStore.getState().setComputation(createEmptyComputationSelection(nextId));
    useParameterValuesStore.getState().setParameterValues([]);
    await loadComputationCatalog();
    await initLayerSettingsForEnvironment(nextId);
    await loadLayerSettings(nextId);
    await initEnvironmentGeoAnchorFromSystem(nextId);
    await useGeoAnchorStore.getState().loadSystemGeoAnchor();
    await useGeoAnchorStore.getState().loadEnvironmentGeoAnchor(nextId);
    useEnvPointStore.getState().clearPoints();
    await deleteEnvPointsByEnvironment(nextId);
    await useEnvPointStore.getState().loadEnvPoints(nextId);
    useComputeResultStore.getState().resetResult();
}

/** Discards the current environment and starts a blank one without saving. */
export async function resetWorkspace(): Promise<void> {
    const nextId = await resolveNextEnvironmentId();
    const env = { ...BLANK_ENV, id: nextId };
    useEnvStore.getState().setEnv(env);
    useEnvStore.getState().setComputation(createEmptyComputationSelection(nextId));
    useEnvStore.getState().clearDirty();
    useParameterValuesStore.getState().setParameterValues([]);
    useSaveModeStore.getState().setMode("session");
    useCanvasObjectStore.getState().setObjects([]);
    useCanvasHistoryStore.getState().resetHistory();
    await initLayerSettingsForEnvironment(nextId);
    await loadLayerSettings(nextId);
    await initEnvironmentGeoAnchorFromSystem(nextId);
    await useGeoAnchorStore.getState().loadSystemGeoAnchor();
    await useGeoAnchorStore.getState().loadEnvironmentGeoAnchor(nextId);
    useEnvPointStore.getState().clearPoints();
    await deleteEnvPointsByEnvironment(nextId);
    await useEnvPointStore.getState().loadEnvPoints(nextId);
    useComputeResultStore.getState().resetResult();
}

/** Loads an existing environment and its canvas objects from IndexedDB. */
export async function loadWorkspace(environmentId: number): Promise<void> {
    const env = await getEnvironment(environmentId);
    if (!env) return;
    useSaveModeStore.getState().setMode(modeAfterFirstSave());
    await loadCanvasForEnvironment(env);
    const { objects } = useCanvasObjectStore.getState();
    const zoneObjectCount = countByCategory(objects, OBJECT_CATEGORY.ZONE);
    const obstacleObjectCount = countByCategory(objects, OBJECT_CATEGORY.OBSTACLE);
    useEnvStore.getState().setEnv({ ...env, zoneCount: zoneObjectCount, obstacleCount: obstacleObjectCount });
    useEnvStore.getState().clearDirty();
    const [computation, parameterValues] = await Promise.all([
        getComputationSelection(environmentId),
        getAlgorithmParametersByEnvironment(environmentId),
    ]);
    // Set parameter values before computation so the panel's init effect sees loaded values
    // when it fires in response to the algorithm/provider selection being restored.
    useParameterValuesStore.getState().setParameterValues(parameterValues);
    useEnvStore.getState().setComputation(computation);
    useCanvasHistoryStore.getState().resetHistory();
    const setups = await getAllLayerSettingsSetup();
    await addMissingLayerSettingsForEnvironment(environmentId, setups);
    await loadLayerSettings(environmentId);
    await initEnvironmentGeoAnchorFromSystem(environmentId);
    await useGeoAnchorStore.getState().loadSystemGeoAnchor();
    await useGeoAnchorStore.getState().loadEnvironmentGeoAnchor(environmentId);
    useEnvPointStore.getState().clearPoints();
    await useEnvPointStore.getState().loadEnvPoints(environmentId);
    const existingResult = await getComputeResult(environmentId);
    if (existingResult) {
        useComputeResultStore.getState().loadResult(existingResult);
    } else {
        useComputeResultStore.getState().resetResult();
    }
}

/** Saves the current canvas as a new environment or overwrites an existing one, then loads it. */
export async function saveAsWorkspace(name: string, selectedEnvId: number | null): Promise<void> {
    const { env, computation } = useEnvStore.getState();
    const { objects } = useCanvasObjectStore.getState();
    const { startPoint, endPoint, startEndPoint } = useEnvPointStore.getState();
    const targetId = selectedEnvId ?? (await resolveNextEnvironmentId());
    const targetEnv: Environment = { ...env, id: targetId, name };
    const activeGeoAnchor = useGeoAnchorStore.getState().environmentGeoAnchor;
    const sourcePoints = [startPoint, endPoint, startEndPoint].filter(isDefined);
    if (selectedEnvId !== null) {
        await Promise.all([
            deleteObjectsByEnvironment(targetEnv),
            deleteEnvPointsByEnvironment(targetId),
        ]);
    }
    const targetObjects = objects.map((o) => ({ ...o, environmentId: targetId }));
    const { parameterValues } = useParameterValuesStore.getState();
    const targetParamValues = parameterValues.map((pv) => ({ ...pv, environmentId: targetId }));
    await Promise.all([
        saveEnvironment(targetEnv),
        saveComputationSelection({ ...computation, environmentId: targetId }),
        targetParamValues.length > 0 ? saveAlgorithmParameters(targetParamValues) : Promise.resolve(),
        targetObjects.length > 0 ? saveObjects(targetObjects) : Promise.resolve(),
        selectedEnvId === null ? initLayerSettingsForEnvironment(targetId) : Promise.resolve(),
        sourcePoints.length > 0
            ? Promise.all(sourcePoints.map((p) => upsertEnvPoint(targetId, p.type, p.point)))
            : Promise.resolve(),
        persistEnvironmentGeoAnchor(targetId, activeGeoAnchor ?? null),
    ]);
    await loadWorkspace(targetId);
}

/**
 * Copies the current in-memory workspace to a new environment in IndexedDB without switching the
 * active workspace. Returns the newly created environment ID so the caller can offer to load it.
 */
export async function copyWorkspace(name: string): Promise<number> {
    const { env, computation } = useEnvStore.getState();
    const { objects } = useCanvasObjectStore.getState();
    const { startPoint, endPoint, startEndPoint } = useEnvPointStore.getState();
    const { parameterValues } = useParameterValuesStore.getState();
    const sourcePoints = [startPoint, endPoint, startEndPoint].filter(isDefined);
    const activeGeoAnchor = useGeoAnchorStore.getState().environmentGeoAnchor;
    const targetId = await resolveNextEnvironmentId();
    const targetEnv: Environment = { ...env, id: targetId, name };
    const targetObjects = objects.map((o) => ({ ...o, environmentId: targetId }));
    const targetParamValues = parameterValues.map((pv) => ({ ...pv, environmentId: targetId }));
    await Promise.all([
        saveEnvironment(targetEnv),
        saveComputationSelection({ ...computation, environmentId: targetId }),
        targetParamValues.length > 0 ? saveAlgorithmParameters(targetParamValues) : Promise.resolve(),
        targetObjects.length > 0 ? saveObjects(targetObjects) : Promise.resolve(),
        initLayerSettingsForEnvironment(targetId),
        sourcePoints.length > 0
            ? Promise.all(sourcePoints.map((p) => upsertEnvPoint(targetId, p.type, p.point)))
            : Promise.resolve(),
        persistEnvironmentGeoAnchor(targetId, activeGeoAnchor ?? null),
    ]);
    return targetId;
}

/**
 * Imports a parsed workspace from an XML file into a new environment in IndexedDB, then loads it.
 * Parameter values and computation selection are reset to empty (they are not part of the export format).
 */
export async function importWorkspace(data: ImportedWorkspaceData): Promise<void> {
    const targetId = await resolveNextEnvironmentId();

    const zoneCount = countByCategory(data.objects, OBJECT_CATEGORY.ZONE);
    const obstacleCount = countByCategory(data.objects, OBJECT_CATEGORY.OBSTACLE);

    const targetEnv: Environment = {
        id: targetId,
        name: data.name,
        format: data.format,
        type: data.type,
        coordSystem: data.coordSystem,
        headlandEnabled: data.headlandEnabled,
        headlandWidth: data.headlandWidth,
        zoneCount,
        obstacleCount,
    };

    const targetObjects = data.objects.map((o, i) => ({
        id: o.id > 0 ? o.id : i + 1,
        environmentId: targetId,
        category: o.category,
        type: o.type,
        vertexCount: o.vertices.length,
        area: 0,
        vertices: o.vertices,
    }));

    await Promise.all([
        saveEnvironment(targetEnv),
        saveComputationSelection(createEmptyComputationSelection(targetId)),
        targetObjects.length > 0 ? saveObjects(targetObjects) : Promise.resolve(),
        initLayerSettingsForEnvironment(targetId),
        data.envPoints.length > 0
            ? Promise.all(data.envPoints.map((p) => upsertEnvPoint(targetId, p.type, p.point)))
            : Promise.resolve(),
        data.geoAnchor
            ? persistEnvironmentGeoAnchor(targetId, data.geoAnchor)
            : initEnvironmentGeoAnchorFromSystem(targetId),
    ]);

    await loadWorkspace(targetId);
}

/**
 * Applies an autosave toggle to the current save mode:
 * - Enabling while mode is "manual" → switches to "autosave" and immediately saves any dirty state.
 * - Enabling while mode is "session" → no mode change; autosave activates on the next manual save.
 * - Disabling while mode is "autosave" → switches to "manual".
 */
export async function applyAutoSaveToggle(enabled: boolean): Promise<void> {
    const { mode, setMode } = useSaveModeStore.getState();
    if (enabled && mode === "manual") {
        setMode("autosave");
        await saveCanvas();
    } else if (!enabled && mode === "autosave") {
        setMode("manual");
    }
}
