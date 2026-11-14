import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { ZONE_CATEGORY } from "@/config/db-ops/enums";
import { useMapStore } from "@/model/mapStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { computePolygonPerimeter } from "@/utils/geometry";
import { convertLinear, formatNumber, pickAutoLinearUnit, unitLabel } from "@/utils/unitOfMeasure";

export default function DistanceBetweenVerticesField() {
    const mapId = useMapStore((s) => s.map.id);
    const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const totalPerimeter = useCanvasObjectStore((s) =>
        s.objects
            .filter(
                (o) =>
                    o.mapId === mapId &&
                    (o.category === ZONE_CATEGORY.MOWING || o.category === ZONE_CATEGORY.NO_GO),
            )
            .reduce((sum, o) => sum + computePolygonPerimeter(o.vertices), 0),
    );
    const totalVertices = useCanvasObjectStore((s) =>
        s.objects
            .filter(
                (o) =>
                    o.mapId === mapId &&
                    (o.category === ZONE_CATEGORY.MOWING || o.category === ZONE_CATEGORY.NO_GO),
            )
            .reduce((sum, o) => sum + o.vertices.length, 0),
    );

    if (totalVertices === 0) {
        return <InspectorPanelSectionField label="Distance between vertices" value="—" />;
    }

    const avg = totalPerimeter / totalVertices;
    const displayUnit = pickAutoLinearUnit(avg, selectedUnit);
    return (
        <InspectorPanelSectionField
            label="Distance between vertices"
            value={formatNumber(convertLinear(avg, selectedUnit, displayUnit), 2)}
            unit={unitLabel(displayUnit)}
        />
    );
}
