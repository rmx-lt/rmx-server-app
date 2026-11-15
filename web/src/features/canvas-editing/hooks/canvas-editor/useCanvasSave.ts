import { useEffect } from "react";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { requestAutosave } from "@/features/canvas-editing/data/canvasBridge";
import { useMapStore } from "@/model/mapStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

/**
 * Asks for an autosave whenever the open map changes (canvas objects, map
 * fields, its geo anchor). The save itself is
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
            useMapStore.subscribe((s, prev) => {
                if (s.isMapDirty && s.map !== prev.map) requestAutosave();
            }),
            useGeoAnchorStore.subscribe((s, prev) => {
                if (s.isMapGeoAnchorDirty && s.mapDraft !== prev.mapDraft) requestAutosave();
            }),
        ];
        return () => unsubscribes.forEach((u) => u());
    }, []);
}
