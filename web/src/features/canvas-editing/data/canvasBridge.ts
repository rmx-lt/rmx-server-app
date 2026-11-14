import { saveMap, type MapContent } from "@/data/planning/maps";
import { isConflict } from "@/data/api/planning";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import type { Object } from "@/data/planning/schemaTypes";
import { useCanvasObjectStore, selectIsDirty } from "../stores/canvasObjectStore";
import { useEnvStore } from "@/model/envStore";
import { getLayerSettingParameters, useLayerSettingsStore } from "@/model/layerSettingsStore";
import { getEnvPoints, useEnvPointStore } from "@/model/envPointStore";
import { getSavableEnvironmentGeoAnchor, useGeoAnchorStore } from "@/model/geoAnchorStore";
import { getSaveMode } from "@/model/saveModeStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

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

// ── The open map ───────────────────────────────────────────────────────────

/** Everything the stores hold of the open map, as one map's content. */
export function currentMapContent(): MapContent {
    return {
        env: useEnvStore.getState().env,
        objects: useCanvasObjectStore.getState().objects,
        points: getEnvPoints(useEnvPointStore.getState()),
        geoAnchor: getSavableEnvironmentGeoAnchor(useGeoAnchorStore.getState()),
        layerSettings: getLayerSettingParameters(useLayerSettingsStore.getState().layers),
    };
}

/** True when anything of the open map (or the default geo anchor) changed since the last save or load. */
export function isMapDirty(): boolean {
    const geo = useGeoAnchorStore.getState();
    return (
        useEnvStore.getState().isEnvDirty ||
        selectIsDirty(useCanvasObjectStore.getState()) ||
        useLayerSettingsStore.getState().isLayerSettingsDirty ||
        useEnvPointStore.getState().isEnvPointsDirty ||
        geo.isSystemGeoAnchorDirty ||
        geo.isEnvironmentGeoAnchorDirty
    );
}

/** Gives the stores the id the server assigned to a new map. */
function adoptMapId(id: number): void {
    useEnvStore.setState((s) => ({ env: { ...s.env, id } }));
    useCanvasObjectStore.setState((s) => ({ objects: s.objects.map((o) => ({ ...o, environmentId: id })) }));
}

function markSaved(): void {
    useCanvasObjectStore.getState().clearDirty();
    useEnvStore.getState().clearDirty();
    useLayerSettingsStore.getState().clearDirty();
    useEnvPointStore.getState().clearDirty();
}

function reportSaveError(err: unknown): void {
    console.error("saving the map failed", err);
    const conflict = isConflict(err);
    useConfirmationModalStore.getState().requestConfirmation({
        title: conflict ? "Map Changed Elsewhere" : "Save Failed",
        message: conflict
            ? "This map was saved in another window since you opened it, so your changes were not saved. " +
              "Use File → Save As to keep them as a new map, or File → Open to load the other version."
            : `Your changes were not saved: ${err instanceof Error ? err.message : String(err)}`,
        tone: "danger",
        confirmLabel: "Dismiss",
    });
}

// ── Canvas save ────────────────────────────────────────────────────────────

let _isSaving = false;

/**
 * Saves the open map to the server as a whole (a new map gets its id here).
 * Returns true when something was saved, false when nothing was dirty, a
 * save was already running, or the save failed (the user is told why).
 */
export async function saveCanvas(): Promise<boolean> {
    if (_isSaving || !isMapDirty()) return false;

    _isSaving = true;
    try {
        const content = currentMapContent();
        const id = await saveMap(content);
        if (content.env.id !== id) adoptMapId(id);
        await useGeoAnchorStore.getState().saveGeoAnchors();
        markSaved();
        return true;
    } catch (err) {
        reportSaveError(err);
        return false;
    } finally {
        _isSaving = false;
    }
}

// ── Autosave ───────────────────────────────────────────────────────────────

const AUTOSAVE_DELAY_MS = 1000;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * With autosave on, saves the map a moment after the last change (a burst
 * of edits is one save). A change made while a save runs is saved after it.
 */
export function requestAutosave(): void {
    if (getSaveMode() !== "autosave") return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        if (_isSaving) {
            requestAutosave();
            return;
        }
        void saveCanvas();
    }, AUTOSAVE_DELAY_MS);
}

/**
 * Runs a pending autosave now. Call before the open map is replaced (another
 * map opened, a new one started), so the last changes aren't lost.
 */
export async function flushAutosave(): Promise<void> {
    clearTimeout(autosaveTimer);
    if (getSaveMode() === "autosave" && isMapDirty()) await saveCanvas();
}
