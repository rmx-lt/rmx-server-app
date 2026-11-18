import { useEffect } from "react";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { requestSave } from "@/features/canvas-editing/data/canvasBridge";
import { useMapStore } from "@/model/mapStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

/**
 * Asks for a save whenever the open map changes (canvas objects, its name, its zone names,
 * its geo anchor). Showing a map also changes them; the map bridge then drops
 * the request (resetSave).
 *
 * Mount once inside `CanvasEditor` or a similar root canvas component.
 */
export function useCanvasAutosave(): void {
    useEffect(() => {
        const unsubscribes = [
            useCanvasObjectStore.subscribe((s, prev) => {
                if (s.dirtyObjects !== prev.dirtyObjects || s.deletedObjects !== prev.deletedObjects) requestSave();
            }),
            useMapStore.subscribe((s, prev) => {
                if (s.map.name !== prev.map.name || s.zones !== prev.zones) requestSave();
            }),
            useGeoAnchorStore.subscribe((s, prev) => {
                if (s.mapGeoAnchor !== prev.mapGeoAnchor) requestSave();
            }),
        ];
        return () => unsubscribes.forEach((u) => u());
    }, []);
}
