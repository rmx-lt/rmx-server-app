import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";

export default function SelectedVertexCountField() {
    const selectedVertexCount = useCanvasSelectionStore((s) => s.selectedVertexRefs.length);

    if (selectedVertexCount <= 1) return null;

    return (
        <InspectorPanelSectionField
            label="Number of vertices"
            value={selectedVertexCount}
        />
    );
}
