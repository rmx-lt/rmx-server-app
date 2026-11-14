import { useEffect } from "react";
import { useEnvStore } from "@/model/envStore";
import { useLayerSettingsStore } from "@/model/layerSettingsStore";
import { useEnvPointStore } from "@/model/envPointStore";
import { useCanvasObjectStore, selectIsDirty } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";

/**
 * Registers a native browser "Leave site?" dialog while there are changes
 * the server doesn't have yet. With autosave on that is only the moment
 * before the next save (or after a failed one).
 */
export function useBeforeUnload(): void {
    const isEnvDirty = useEnvStore((state) => state.isEnvDirty);
    const isCanvasDirty = useCanvasObjectStore(selectIsDirty);
    const isSystemGeoAnchorDirty = useGeoAnchorStore((state) => state.isSystemGeoAnchorDirty);
    const isEnvironmentGeoAnchorDirty = useGeoAnchorStore((state) => state.isEnvironmentGeoAnchorDirty);
    const isLayerSettingsDirty = useLayerSettingsStore((state) => state.isLayerSettingsDirty);
    const isEnvPointsDirty = useEnvPointStore((state) => state.isEnvPointsDirty);

    const shouldWarn =
        isEnvDirty || isCanvasDirty || isSystemGeoAnchorDirty || isEnvironmentGeoAnchorDirty || isLayerSettingsDirty || isEnvPointsDirty;

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
