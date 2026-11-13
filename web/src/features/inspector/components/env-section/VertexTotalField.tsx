import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import { useEnvStore } from "@/model/envStore";

export default function VertexTotalField() {
    const envId = useEnvStore((s) => s.env.id);
    const totalVertices = useCanvasObjectStore((s) =>
        s.objects
            .filter(
                (o) =>
                    o.environmentId === envId &&
                    (o.category === OBJECT_CATEGORY.ZONE || o.category === OBJECT_CATEGORY.OBSTACLE),
            )
            .reduce((sum, o) => sum + o.vertices.length, 0),
    );

    return <InspectorPanelSectionField label="Number of vertices" value={String(totalVertices)} />;
}
