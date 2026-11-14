import { useState } from "react";
import InspectorPanelSectionInput from "@/components/inspector-panel/InspectorPanelSectionInput";
import InspectorPanelSectionButton from "@/components/inspector-panel/InspectorPanelSectionButton";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";

export default function ModifierSection() {
    const selectedObjectId = useCanvasSelectionStore((s) => s.selectedObject?.id);
    const selectVertex = useCanvasSelectionStore((s) => s.selectVertex);

    const selectedObjectCategory = useCanvasObjectStore(
        (s) => s.objects.find((o) => o.id === selectedObjectId)?.category,
    );
    const modifyObjectVertices = useCanvasObjectStore((s) => s.modifyObjectVertices);

    const [multiplier, setMultiplier] = useState("1");
    const [maxOffset, setMaxOffset] = useState("0");

    if (
        !selectedObjectId ||
        (selectedObjectCategory !== OBJECT_CATEGORY.ZONE &&
            selectedObjectCategory !== OBJECT_CATEGORY.OBSTACLE)
    ) {
        return null;
    }

    const parsedMultiplier = parseFloat(multiplier);
    const parsedOffset = parseFloat(maxOffset);
    const isValid =
        !isNaN(parsedMultiplier) &&
        parsedMultiplier > 0 &&
        !isNaN(parsedOffset) &&
        parsedOffset >= 0;

    function handleApply() {
        if (!selectedObjectId || !isValid) return;
        modifyObjectVertices(selectedObjectId, parsedMultiplier, parsedOffset);
        // Clear any vertex sub-selection — indices are stale after modification
        selectVertex(null);
    }

    return (
        <>
            <InspectorPanelSectionInput
                label="Vertex multiplier"
                value={multiplier}
                onChange={setMultiplier}
                type="number"
                min={0.01}
                step={0.1}
            />
            <InspectorPanelSectionInput
                label="Max random offset"
                value={maxOffset}
                onChange={setMaxOffset}
                type="number"
                min={0}
                step={1}
            />
            <InspectorPanelSectionButton
                label="Apply"
                onClick={handleApply}
                disabled={!isValid}
                variant="primary"
            />
        </>
    );
}
