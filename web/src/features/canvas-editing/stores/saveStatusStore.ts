import { create } from "zustand";
import { useEnvStore } from "@/model/envStore";
import { useSaveModeStore } from "@/model/saveModeStore";
import { useCanvasObjectStore, selectIsDirty } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { useEnvPointStore } from "@/model/envPointStore";
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
    const { isEnvDirty } = useEnvStore.getState();
    const isCanvasDirty = selectIsDirty(useCanvasObjectStore.getState());
    const { isLayerSettingsDirty } = useLayerSettingsStore.getState();
    const { mode } = useSaveModeStore.getState();

    const { isEnvPointsDirty } = useEnvPointStore.getState();
    const { isSystemGeoAnchorDirty, isEnvironmentGeoAnchorDirty } = useGeoAnchorStore.getState();

    const isDirty = isEnvDirty || isCanvasDirty || isLayerSettingsDirty || isEnvPointsDirty || isSystemGeoAnchorDirty || isEnvironmentGeoAnchorDirty;

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

useEnvStore.subscribe(syncStatus);
useCanvasObjectStore.subscribe(syncStatus);
useSaveModeStore.subscribe(syncStatus);
useLayerSettingsStore.subscribe(syncStatus);
useEnvPointStore.subscribe(syncStatus);
useGeoAnchorStore.subscribe(syncStatus);
