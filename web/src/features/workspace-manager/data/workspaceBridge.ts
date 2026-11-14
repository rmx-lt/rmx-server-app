import { createMap, loadMap, overwriteMap, type MapContent } from "@/data/planning/maps";
import { initialLayerSettings } from "@/data/planning/layerSettings";
import { COORD_SYSTEM, ENV_FORMAT, ENV_TYPE, OBJECT_CATEGORY } from "@/config/db-ops/enums";
import type { Environment } from "@/data/planning/schemaTypes";
import type { ImportedWorkspaceData } from "@/features/workspace-manager/utils/importWorkspace";
import { useEnvStore } from "@/model/envStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useSaveModeStore } from "@/model/saveModeStore";
import { loadLayerSettings } from "@/model/layerSettingsStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { currentMapContent, flushAutosave, saveCanvas } from "@/features/canvas-editing/data/canvasBridge";

// Opening, starting, copying and importing maps. The maps live on the server
// (src/data/planning/maps.ts); the stores hold the open one. A new map has
// id 0 until its first save, when the server gives it one.

const BLANK_ENV: Environment = {
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

function countByCategory(objects: { category: string }[], category: string): number {
    return objects.filter((o) => o.category === category).length;
}

function modeAfterFirstSave(): "manual" | "autosave" {
    return useSaveModeStore.getState().isAutoSaveEnabled ? "autosave" : "manual";
}

/** Puts a map into the stores, clean (nothing to save). */
function showMap(content: MapContent): void {
    const { objects } = content;
    useEnvStore.getState().setEnv({
        ...content.env,
        zoneCount: countByCategory(objects, OBJECT_CATEGORY.ZONE),
        obstacleCount: countByCategory(objects, OBJECT_CATEGORY.OBSTACLE),
    });
    useEnvStore.getState().clearDirty();
    useCanvasObjectStore.getState().setObjects(objects);
    useCanvasHistoryStore.getState().resetHistory();
    loadLayerSettings(content.layerSettings);
    useEnvPointStore.getState().setPoints(content.points);
    useGeoAnchorStore.getState().setLoadedEnvironmentGeoAnchor(content.geoAnchor);
}

/** Starts a blank, unsaved map placed at the user's default geo anchor. */
async function showBlankMap(): Promise<void> {
    await useGeoAnchorStore.getState().loadSystemGeoAnchor();
    showMap({
        env: BLANK_ENV,
        objects: [],
        points: [],
        geoAnchor: useGeoAnchorStore.getState().systemGeoAnchor,
        layerSettings: initialLayerSettings(0),
    });
}

/** Starts a blank map at app startup. */
export async function initializeWorkspace(): Promise<void> {
    useSaveModeStore.getState().setMode("session");
    await showBlankMap();
}

/** Discards the open map and starts a blank one without saving. */
export async function resetWorkspace(): Promise<void> {
    await flushAutosave();
    useSaveModeStore.getState().setMode("session");
    await showBlankMap();
}

/** Opens a saved map. */
export async function loadWorkspace(environmentId: number): Promise<void> {
    await flushAutosave();
    const content = await loadMap(environmentId);
    useSaveModeStore.getState().setMode(modeAfterFirstSave());
    showMap(content);
}

/** Saves the open map as a new map, or over an existing one (selectedEnvId), then opens it. */
export async function saveAsWorkspace(name: string, selectedEnvId: number | null): Promise<void> {
    const content = currentMapContent();
    const id = selectedEnvId === null ? await createMap(content, name) : await overwriteMap(selectedEnvId, content, name);
    await loadWorkspace(id);
}

/**
 * Saves a copy of the open map as a new map without switching to it.
 * Returns the copy's id, so the caller can offer to open it.
 */
export async function copyWorkspace(name: string): Promise<number> {
    return createMap(currentMapContent(), name);
}

/** Saves a map read from an XML file as a new map, then opens it. */
export async function importWorkspace(data: ImportedWorkspaceData): Promise<void> {
    await useGeoAnchorStore.getState().loadSystemGeoAnchor();
    const objects = data.objects.map((o, i) => ({
        id: o.id > 0 ? o.id : i + 1,
        environmentId: 0,
        category: o.category,
        type: o.type,
        vertexCount: o.vertices.length,
        area: 0,
        vertices: o.vertices,
    }));
    const id = await createMap(
        {
            env: {
                id: 0,
                name: data.name,
                format: data.format,
                type: data.type,
                coordSystem: data.coordSystem,
                headlandEnabled: data.headlandEnabled,
                headlandWidth: data.headlandWidth,
                zoneCount: countByCategory(objects, OBJECT_CATEGORY.ZONE),
                obstacleCount: countByCategory(objects, OBJECT_CATEGORY.OBSTACLE),
            },
            objects,
            points: data.envPoints.map((p) => ({ environmentId: 0, type: p.type, point: p.point })),
            geoAnchor: data.geoAnchor ?? useGeoAnchorStore.getState().systemGeoAnchor,
            layerSettings: initialLayerSettings(0),
        },
        data.name,
    );
    await loadWorkspace(id);
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
