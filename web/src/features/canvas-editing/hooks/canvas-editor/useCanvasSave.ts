import { useEffect } from "react";
import { useCanvasObjectStore, selectIsDirty } from "@/features/canvas-editing/stores/canvasObjectStore";
import { saveCanvas } from "@/features/canvas-editing/data/canvasBridge";
import { getSaveMode } from "@/model/saveModeStore";

/**
 * Subscribes to canvas object changes and triggers an autosave whenever the
 * canvas becomes dirty and the save mode is "autosave".
 *
 * Mount once inside `CanvasEditor` or a similar root canvas component.
 */
export function useCanvasAutosave(): void {
    useEffect(() => {
        return useCanvasObjectStore.subscribe((state, prev) => {
            if (selectIsDirty(state) && !selectIsDirty(prev) && getSaveMode() === "autosave") {
                saveCanvas().catch(console.error);
            }
        });
    }, []);
}
