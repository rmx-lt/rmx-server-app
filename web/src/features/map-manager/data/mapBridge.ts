import { createMap, loadMap, overwriteMap, type MapContent } from "@/data/planning/maps";
import { ZONE_CATEGORY } from "@/config/db-ops/enums";
import type { MapInfo } from "@/data/planning/schemaTypes";
import { useMapStore } from "@/model/mapStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useSaveModeStore } from "@/model/saveModeStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { currentMapContent, flushAutosave, saveCanvas } from "@/features/canvas-editing/data/canvasBridge";

// Opening, starting, copying and importing maps. The maps live on the server
// (src/data/planning/maps.ts); the stores hold the open one. A new map has
// id 0 until its first save, when the server gives it one.

const BLANK_MAP: MapInfo = {
    id: 0,
    name: "Untitled Map",
    mowingZoneCount: 0,
    noGoZoneCount: 0,
};

function countByCategory(zones: { category: string }[], category: string): number {
    return zones.filter((z) => z.category === category).length;
}

function modeAfterFirstSave(): "manual" | "autosave" {
    return useSaveModeStore.getState().isAutoSaveEnabled ? "autosave" : "manual";
}

/** Puts a map into the stores, clean (nothing to save). */
function showMap(content: MapContent): void {
    const { zones } = content;
    useMapStore.getState().setMap({
        ...content.map,
        mowingZoneCount: countByCategory(zones, ZONE_CATEGORY.MOWING),
        noGoZoneCount: countByCategory(zones, ZONE_CATEGORY.NO_GO),
    });
    useMapStore.getState().clearDirty();
    useCanvasObjectStore.getState().setObjects(zones);
    useCanvasHistoryStore.getState().resetHistory();
    useGeoAnchorStore.getState().setLoadedMapGeoAnchor(content.geoAnchor);
}

/** Starts a blank, unsaved map placed at the user's default geo anchor. */
async function showBlankMap(): Promise<void> {
    await useGeoAnchorStore.getState().loadSystemGeoAnchor();
    showMap({
        map: BLANK_MAP,
        zones: [],
        geoAnchor: useGeoAnchorStore.getState().systemGeoAnchor,
    });
}

/** Starts a blank map at app startup. */
export async function initializeMap(): Promise<void> {
    useSaveModeStore.getState().setMode("session");
    await showBlankMap();
}

/** Discards the open map and starts a blank one without saving. */
export async function resetMap(): Promise<void> {
    await flushAutosave();
    useSaveModeStore.getState().setMode("session");
    await showBlankMap();
}

/** Opens a saved map. */
export async function openMap(mapId: number): Promise<void> {
    await flushAutosave();
    const content = await loadMap(mapId);
    useSaveModeStore.getState().setMode(modeAfterFirstSave());
    showMap(content);
}

/** Saves the open map as a new map, or over an existing one (selectedEnvId), then opens it. */
export async function saveMapAs(name: string, selectedMapId: number | null): Promise<void> {
    const content = currentMapContent();
    const id = selectedMapId === null ? await createMap(content, name) : await overwriteMap(selectedMapId, content, name);
    await openMap(id);
}

/**
 * Saves a copy of the open map as a new map without switching to it.
 * Returns the copy's id, so the caller can offer to open it.
 */
export async function copyMap(name: string): Promise<number> {
    return createMap(currentMapContent(), name);
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
