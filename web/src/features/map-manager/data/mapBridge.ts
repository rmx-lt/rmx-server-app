import { createMap, listMaps, loadMap, type MapContent } from "@/data/planning/maps";
import { ZONE_CATEGORY } from "@/config/db-ops/enums";
import type { MapInfo } from "@/data/planning/schemaTypes";
import { useMapStore } from "@/model/mapStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasHistoryStore } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { currentMapContent, flushSave, resetSave } from "@/features/canvas-editing/data/canvasBridge";

// Opening, starting and duplicating maps. The maps live on the server
// (src/data/planning/maps.ts), a new one from the moment it is made; the
// stores hold the open one, and the autosave keeps it saved. A map with
// id 0 exists only when the server could not be reached at startup; its
// first save creates it.

const BLANK_MAP: MapInfo = {
    id: 0,
    name: "Untitled Map",
    mowingZoneCount: 0,
    noGoZoneCount: 0,
};

function countByCategory(zones: { category: string }[], category: string): number {
    return zones.filter((z) => z.category === category).length;
}

/** Puts a map into the stores; showing it is not a change to save. */
function showMap(content: MapContent): void {
    const { zones } = content;
    useMapStore.getState().setMap({
        ...content.map,
        mowingZoneCount: countByCategory(zones, ZONE_CATEGORY.MOWING),
        noGoZoneCount: countByCategory(zones, ZONE_CATEGORY.NO_GO),
    });
    useCanvasObjectStore.getState().setObjects(zones);
    useCanvasHistoryStore.getState().resetHistory();
    useGeoAnchorStore.getState().setLoadedMapGeoAnchor(content.geoAnchor);
    resetSave();
}

/** Creates a blank map on the server, placed at the user's default geo anchor. Returns its id. */
async function createBlankMap(): Promise<number> {
    await useGeoAnchorStore.getState().loadSystemGeoAnchor();
    return createMap({ map: BLANK_MAP, zones: [], geoAnchor: useGeoAnchorStore.getState().systemGeoAnchor }, BLANK_MAP.name);
}

/** Opens the map changed last, or makes a new one when there is none. Nothing is saved first. */
export async function openLatestMap(): Promise<void> {
    const [latest] = await listMaps();
    showMap(await loadMap(latest ? latest.id : await createBlankMap()));
}

/** Opens a map. */
export async function openMap(mapId: number): Promise<void> {
    await flushSave();
    showMap(await loadMap(mapId));
}

/** Makes a new map on the server and opens it. */
export async function newMap(): Promise<void> {
    await flushSave();
    showMap(await loadMap(await createBlankMap()));
}

/** Makes a copy of the open map on the server and opens it. */
export async function duplicateMap(): Promise<void> {
    await flushSave();
    const content = currentMapContent();
    showMap(await loadMap(await createMap(content, `${content.map.name} (copy)`)));
}
