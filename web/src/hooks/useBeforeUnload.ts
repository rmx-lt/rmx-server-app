import { useEffect } from "react";
import { useEnvStore } from "@/model/envStore";
import { useSaveModeStore } from "@/model/saveModeStore";
import { useCanvasObjectStore, selectIsDirty } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

/**
 * Registers a native browser "Leave site?" dialog when there are unsaved
 * changes and autosave is not active. No warning is shown when the session
 * is clean or autosave is protecting the data.
 */
export function useBeforeUnload(): void {
    const isEnvDirty = useEnvStore((state) => state.isEnvDirty);
    const isCanvasDirty = useCanvasObjectStore(selectIsDirty);
    const isSystemGeoAnchorDirty = useGeoAnchorStore((state) => state.isSystemGeoAnchorDirty);
    const isEnvironmentGeoAnchorDirty = useGeoAnchorStore((state) => state.isEnvironmentGeoAnchorDirty);
    const mode = useSaveModeStore((state) => state.mode);

    const isDirty = isEnvDirty || isCanvasDirty || isSystemGeoAnchorDirty || isEnvironmentGeoAnchorDirty;
    const shouldWarn = isDirty && mode !== "autosave";

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
