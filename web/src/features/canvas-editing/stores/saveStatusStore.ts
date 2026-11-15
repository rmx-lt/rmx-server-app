import { create } from "zustand";
import { useMapStore } from "@/model/mapStore";
import { useSaveModeStore } from "@/model/saveModeStore";
import { useCanvasObjectStore, selectIsDirty } from "@/features/canvas-editing/stores/canvasObjectStore";
import { saveCanvas } from "@/features/canvas-editing/data/canvasBridge";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SaveStatus = "nothing_to_save" | "unsaved" | "saved";

interface SaveStatusState {
    status: SaveStatus;
    save: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Derived status computation (outside React)
// ---------------------------------------------------------------------------

function computeStatus(): SaveStatus {
    const { isMapDirty } = useMapStore.getState();
    const isCanvasDirty = selectIsDirty(useCanvasObjectStore.getState());
    const { mode } = useSaveModeStore.getState();

    const { isSystemGeoAnchorDirty, isMapGeoAnchorDirty } = useGeoAnchorStore.getState();

    const isDirty = isMapDirty || isCanvasDirty || isSystemGeoAnchorDirty || isMapGeoAnchorDirty;

    if (isDirty && mode !== "autosave") return "unsaved";
    if (mode === "autosave" || (mode === "manual" && !isDirty)) return "saved";
    // session mode, nothing changed yet
    return "nothing_to_save";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSaveStatusStore = create<SaveStatusState>()(() => ({
    status: computeStatus(),

    save: async () => {
        const saved = await saveCanvas();
        if (saved) {
            const { mode, setMode, isAutoSaveEnabled } = useSaveModeStore.getState();
            if (mode === "session") setMode(isAutoSaveEnabled ? "autosave" : "manual");
        }
    },
}));

// ---------------------------------------------------------------------------
// Subscriptions — keep status in sync with source stores
// ---------------------------------------------------------------------------

function syncStatus(): void {
    useSaveStatusStore.setState({ status: computeStatus() });
}

useMapStore.subscribe(syncStatus);
useCanvasObjectStore.subscribe(syncStatus);
useSaveModeStore.subscribe(syncStatus);
useGeoAnchorStore.subscribe(syncStatus);
