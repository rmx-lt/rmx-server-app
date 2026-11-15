import { useEffect } from "react";
import { useMapStore } from "@/model/mapStore";
import { useCanvasObjectStore, selectIsDirty } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

/**
 * Registers a native browser "Leave site?" dialog while there are changes
 * the server doesn't have yet. With autosave on that is only the moment
 * before the next save (or after a failed one).
 */
export function useBeforeUnload(): void {
    const isMapDirty = useMapStore((state) => state.isMapDirty);
    const isCanvasDirty = useCanvasObjectStore(selectIsDirty);
    const isSystemGeoAnchorDirty = useGeoAnchorStore((state) => state.isSystemGeoAnchorDirty);
    const isMapGeoAnchorDirty = useGeoAnchorStore((state) => state.isMapGeoAnchorDirty);

    const shouldWarn =
        isMapDirty || isCanvasDirty || isSystemGeoAnchorDirty || isMapGeoAnchorDirty;

    useEffect(() => {
        if (!shouldWarn) return;

        function handleBeforeUnload(e: BeforeUnloadEvent): void {
            e.preventDefault();
        }

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, [shouldWarn]);
}
