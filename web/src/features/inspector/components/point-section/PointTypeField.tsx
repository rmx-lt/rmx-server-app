import InspectorPanelSectionSelectField from "@/components/inspector-panel/InspectorPanelSectionSelectField";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useMapPointStore } from "@/model/mapPointStore";
import { useMapStore } from "@/model/mapStore";
import { useConfirmationModalStore } from "@/components/modals/confirmation-modal/confirmationModalStore";
import type { MapPointType } from "@/data/planning/schemaTypes";

const POINT_TYPE_OPTIONS = [
    { value: "start", label: "Start" },
    { value: "end", label: "End" },
    { value: "start_end", label: "Start & End" },
];

export default function PointTypeField() {
    const selectedMapPointType = useCanvasSelectionStore((s) => s.selectedMapPointType);
    const selectMapPoint = useCanvasSelectionStore((s) => s.selectMapPoint);
    const startPoint = useMapPointStore((s) => s.startPoint);
    const endPoint = useMapPointStore((s) => s.endPoint);
    const changePointType = useMapPointStore((s) => s.changePointType);
    const mapId = useMapStore((s) => s.map.id);
    const requestConfirmation = useConfirmationModalStore((s) => s.requestConfirmation);

    if (!selectedMapPointType) return null;

    function handleChange(newType: string) {
        const toType = newType as MapPointType;
        if (toType === selectedMapPointType) return;

        // Determine which existing point (if any) will be removed by this change
        let conflictPoint;
        let conflictTypeName: string;
        if (toType === "start_end") {
            // start_end clears both; warn about whichever exists besides fromType
            conflictPoint = selectedMapPointType === "start" ? endPoint : startPoint;
            conflictTypeName = selectedMapPointType === "start" ? "end" : "start";
        } else {
            conflictPoint = toType === "start" ? startPoint : endPoint;
            conflictTypeName = toType;
        }

        if (conflictPoint) {
            requestConfirmation({
                title: "Point type already in use",
                message: `A ${conflictTypeName} point already exists. Continuing will remove it.`,
                tone: "warning",
                confirmLabel: "Continue",
                confirmAction: async () => {
                    await changePointType(mapId, selectedMapPointType!, toType);
                    selectMapPoint(toType);
                },
            });
        } else {
            changePointType(mapId, selectedMapPointType!, toType).then(() => {
                selectMapPoint(toType);
            });
        }
    }

    return (
        <InspectorPanelSectionSelectField
            label="Type"
            value={selectedMapPointType}
            options={POINT_TYPE_OPTIONS}
            onChange={handleChange}
        />
    );
}
