import { createMap, deleteMap, listMaps, loadMap as fetchContent, renameMap, MapFormatError, type MapContent } from "@/data/planning/maps";
import type { MapInfo } from "@/data/planning/schemaTypes";
import { FIRST_ZONE, useMapStore } from "@/model/mapStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useMapListStore } from "@/model/mapListStore";
import { readLastMapId, rememberLastMapId, usePageStore } from "@/model/pageStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";
import { currentMapContent, flushSave, requestSave, resetSave } from "@/features/canvas-editing/data/canvasBridge";

// Opening, starting, duplicating and deleting maps. The maps live on the server
// (src/data/planning/maps.ts), a new one from the moment it is made; the
// stores hold the open one, and the autosave keeps it saved. A map with
// id 0 exists only when the server could not be reached at startup; its
// first save creates it.

const BLANK_MAP: MapInfo = {
    id: 0,
    name: "Untitled Map",
    mowingAreaCount: 0,
    noGoAreaCount: 0,
};

/** Reads a map from the server; when it can't be opened, says why on Home before failing. */
async function loadMap(id: number): Promise<MapContent> {
    try {
        return await fetchContent(id);
    } catch (err) {
        const reason = err instanceof MapFormatError ? err.message : `The map could not be opened (${err instanceof Error ? err.message : "unknown error"}).`;
        useMapListStore.setState({ error: reason });
        throw err;
    }
}

/** Puts a map into the stores; showing it is not a change to save. */
function showMap(content: MapContent): void {
    useMapStore.getState().setMap(content.map, content.zones, content.activeZoneId);
    useCanvasObjectStore.getState().setObjects(content.areas);
    useCanvasHistoryStore.getState().resetHistory();
    useGeoAnchorStore.getState().setLoadedMapGeoAnchor(content.geoAnchor);
    resetSave();
    useGeoAnchorStore.getState().setPromptOpen(false);
    useMapListStore.setState({ error: null });
    rememberLastMapId(content.map.id);
    void useMapListStore.getState().refresh();
}

/** Leaves no map open (the stores hold a blank one) and forgets the last map. */
function closeMap(): void {
    useMapStore.getState().setMap(BLANK_MAP, [FIRST_ZONE], FIRST_ZONE.id);
    useCanvasObjectStore.getState().setObjects([]);
    useCanvasHistoryStore.getState().resetHistory();
    useGeoAnchorStore.getState().setLoadedMapGeoAnchor(undefined);
    resetSave();
    rememberLastMapId(null);
    void useMapListStore.getState().refresh();
}

/** Creates a blank map on the server, without a geo anchor (newMap asks where it is). Returns its id. */
async function createBlankMap(): Promise<number> {
    return createMap({ map: BLANK_MAP, zones: [FIRST_ZONE], activeZoneId: FIRST_ZONE.id, areas: [], geoAnchor: undefined }, BLANK_MAP.name);
}

/** At login: opens the map opened last in this browser; when there is none, it is gone or it can't be opened, shows Home. Nothing is saved first. */
export async function openStartMap(): Promise<void> {
    const wanted = readLastMapId();
    const maps = await listMaps();
    if (wanted !== null && maps.some((m) => m.id === wanted)) {
        try {
            showMap(await loadMap(wanted));
            usePageStore.getState().setPage("workbench");
            return;
        } catch (err) {
            console.error("the last map could not be opened", err);
        }
    }
    closeMap();
    usePageStore.getState().setPage("home");
}

/** Opens a map and shows it in the workbench. */
export async function openMap(mapId: number): Promise<void> {
    await flushSave();
    showMap(await loadMap(mapId));
    usePageStore.getState().setPage("workbench");
}

/** Makes a new map on the server and opens it in the workbench. */
export async function newMap(): Promise<void> {
    await flushSave();
    showMap(await loadMap(await createBlankMap()));
    usePageStore.getState().setPage("workbench");
    useGeoAnchorStore.getState().setPromptOpen(true);
}

/** Makes a copy of a map ("name (copy)") on the server and makes it the open one (the page stays). */
export async function duplicateMap(mapId: number): Promise<void> {
    await flushSave();
    const content = mapId === useMapStore.getState().map.id ? currentMapContent() : await loadMap(mapId);
    showMap(await loadMap(await createMap(content, `${content.map.name} (copy)`)));
}

/** Renames a map. The open one changes in the store and is saved by the autosave. */
export async function renameMapById(mapId: number, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mapId === useMapStore.getState().map.id) {
        useMapStore.getState().setName(trimmed);
        // The canvas that watches the name is not mounted on Home.
        requestSave();
    } else {
        await renameMap(mapId, trimmed);
        await useMapListStore.getState().refresh();
    }
}

/** Asks first, then deletes a map; deleting the open one leaves no map open (the user is on Home). */
export function requestDeleteMap(mapId: number, name: string): void {
    useConfirmationModalStore.getState().requestConfirmation({
        title: "Delete map",
        message: `Delete "${name}"? This cannot be undone.`,
        tone: "danger",
        confirmLabel: "Delete",
        confirmAction: async () => {
            const wasOpen = mapId === useMapStore.getState().map.id;
            // Nothing of a map that is going away is saved.
            if (wasOpen) resetSave();
            await deleteMap(mapId);
            if (wasOpen) closeMap();
            else await useMapListStore.getState().refresh();
        },
    });
}
