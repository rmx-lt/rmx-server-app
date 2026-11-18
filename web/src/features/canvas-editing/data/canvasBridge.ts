import { saveMap, type MapContent } from "@/data/planning/maps";
import { createAutosaver } from "@/data/planning/autosave";
import { AREA_CATEGORY } from "@/config/db-ops/enums";
import type { Area } from "@/data/planning/schemaTypes";
import { useCanvasObjectStore } from "../stores/canvasObjectStore";
import { useMapStore } from "@/model/mapStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useConnectionStore } from "@/model/connectionStore";
import { useMapListStore } from "@/model/mapListStore";
import { useModeStore } from "@/model/modeStore";
import { useCanvasToolStore } from "../stores/canvasToolStore";
import { useCanvasDrawingStore } from "../stores/canvasDrawingStore";

// ── Count synchronization ──────────────────────────────────────────────────
// Reactively keeps the mapStore mowing and no-go area counts derived from the
// canvas area list (the active zone's). Lives here (not in either store) to avoid a circular import.

function countByCategory(objects: Area[], category: string): number {
    return objects.filter((o) => o.category === category).length;
}

function syncMapCounts(objects: Area[]): void {
    const mowingAreaCount = countByCategory(objects, AREA_CATEGORY.MOWING);
    const noGoAreaCount = countByCategory(objects, AREA_CATEGORY.NO_GO);
    useMapStore.setState((s) => ({ map: { ...s.map, mowingAreaCount, noGoAreaCount } }));
}

useCanvasObjectStore.subscribe((next, prev) => {
    if (next.objects !== prev.objects) syncMapCounts(next.objects);
});

// ── The open map ───────────────────────────────────────────────────────────

/** Everything the stores hold of the open map, as one map's content. */
export function currentMapContent(): MapContent {
    const { map, zones, activeZoneId } = useMapStore.getState();
    return {
        map,
        zones,
        activeZoneId,
        areas: useCanvasObjectStore.getState().objects,
        geoAnchor: useGeoAnchorStore.getState().mapGeoAnchor,
    };
}

/** Gives the stores the id the server assigned to a new map. */
function adoptMapId(id: number): void {
    useMapStore.setState((s) => ({ map: { ...s.map, id } }));
    useCanvasObjectStore.setState((s) => ({ objects: s.objects.map((o) => ({ ...o, mapId: id })) }));
}

// ── Saving ─────────────────────────────────────────────────────────────────
// Every change is saved by itself (data/planning/autosave.ts), the whole
// document with its revision. The connection coming back retries a save that
// failed while it was down.

async function saveOpenMap(): Promise<void> {
    const content = currentMapContent();
    const id = await saveMap(content);
    void useMapListStore.getState().refresh();
    // The map shown may have changed while the save ran.
    if (content.map.id !== id && useMapStore.getState().map.id === content.map.id) adoptMapId(id);
}

const autosaver = createAutosaver(saveOpenMap);

/** The open map changed: save it soon. */
export const requestSave = autosaver.request;
/** Saves what is waiting now; throws when it cannot (call before another map replaces the open one). */
export const flushSave = autosaver.flush;
/** Drops what is waiting (another map is shown, or the open one was deleted). */
export const resetSave = autosaver.reset;

useConnectionStore.subscribe((s, prev) => {
    if (s.live && !prev.live) autosaver.retryNow();
});

// A tool belongs to Plan mode: leaving it puts the tool away.
useModeStore.subscribe((s, prev) => {
    if (s.mode === prev.mode) return;
    useCanvasDrawingStore.getState().cancelDrawing();
    useCanvasToolStore.getState().setActiveTool(null);
});
