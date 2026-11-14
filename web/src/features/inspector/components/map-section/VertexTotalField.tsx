import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { ZONE_CATEGORY } from "@/config/db-ops/enums";
import { useMapStore } from "@/model/mapStore";

export default function VertexTotalField() {
    const mapId = useMapStore((s) => s.map.id);
    const totalVertices = useCanvasObjectStore((s) =>
        s.objects
            .filter(
                (o) =>
                    o.mapId === mapId &&
                    (o.category === ZONE_CATEGORY.MOWING || o.category === ZONE_CATEGORY.NO_GO),
            )
            .reduce((sum, o) => sum + o.vertices.length, 0),
    );

    return <InspectorPanelSectionField label="Number of vertices" value={String(totalVertices)} />;
}
