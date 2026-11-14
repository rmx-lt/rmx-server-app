import { useEffect } from "react";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { requestAutosave } from "@/features/canvas-editing/data/canvasBridge";
import { useEnvStore } from "@/model/envStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

/**
 * Asks for an autosave whenever the open map changes (canvas objects, map
 * fields, layer settings, route points, its geo anchor). The save itself is
 * debounced and runs only while the save mode is "autosave".
 *
 * Mount once inside `CanvasEditor` or a similar root canvas component.
 */
export function useCanvasAutosave(): void {
    useEffect(() => {
        const unsubscribes = [
            useCanvasObjectStore.subscribe((s, prev) => {
                if (s.dirtyObjects !== prev.dirtyObjects || s.deletedObjects !== prev.deletedObjects) requestAutosave();
            }),
            useEnvStore.subscribe((s, prev) => {
                if (s.isEnvDirty && s.env !== prev.env) requestAutosave();
            }),
            useLayerSettingsStore.subscribe((s, prev) => {
                if (s.isLayerSettingsDirty && s.layers !== prev.layers) requestAutosave();
            }),
            useEnvPointStore.subscribe((s, prev) => {
                if (s.isEnvPointsDirty && s !== prev) requestAutosave();
            }),
            useGeoAnchorStore.subscribe((s, prev) => {
                if (s.isEnvironmentGeoAnchorDirty && s.environmentDraft !== prev.environmentDraft) requestAutosave();
            }),
        ];
        return () => unsubscribes.forEach((u) => u());
    }, []);
}
