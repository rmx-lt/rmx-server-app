import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import {
    MAP_TYPE_OPTIONS,
    defaultZoneTypeForMap,
    isMapTypeFixed,
    ZONE_TYPE,
    type MapType,
} from "@/config/db-ops/enums";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useMapStore } from "@/model/mapStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";

export default function MapTypeSelection() {
    const type = useMapStore((state) => state.map.type);
    const setType = useMapStore((state) => state.setType);
    const objects = useCanvasObjectStore((state) => state.objects);
    const updateObjectsType = useCanvasObjectStore((state) => state.updateObjectsType);

    function handleChange(newValue: string) {
        const nextType = newValue as MapType;

        if (isMapTypeFixed(nextType)) {
            const nextObjectType = defaultZoneTypeForMap(nextType);
            const mismatchCount = objects.filter((object) => object.type !== nextObjectType).length;

            if (mismatchCount > 0) {
                const typeLabel = nextObjectType === ZONE_TYPE.ONLINE ? "On-Line" : "Off-Line";
                useConfirmationModalStore.getState().requestConfirmation({
                    title: "Update zone types",
                    message: `${mismatchCount} zone${mismatchCount !== 1 ? "s" : ""} will be updated to "${typeLabel}" to match the new map type. Continue?`,
                    tone: "warning",
                    confirmLabel: "Confirm",
                    cancelLabel: "Cancel",
                    confirmAction: async () => {
                        updateObjectsType(nextObjectType);
                        setType(nextType);
                    },
                });
                return;
            }

            updateObjectsType(nextObjectType);
        }

        setType(nextType);
    }

    return (
        <ControlsPanelSectionSelect
            label="Type"
            value={type}
            onChange={handleChange}
            options={MAP_TYPE_OPTIONS}
        />
    );
}
