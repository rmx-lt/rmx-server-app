import InspectorPanelSectionField from "@/components/inspector-panel/InspectorPanelSectionField";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import { useEnvStore } from "@/model/envStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { computePolygonPerimeter } from "@/utils/geometry";
import { convertLinear, formatNumber, pickAutoLinearUnit, unitLabel } from "@/utils/unitOfMeasure";

export default function DistanceBetweenVerticesField() {
    const envId = useEnvStore((s) => s.env.id);
    const selectedUnit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);

    const totalPerimeter = useCanvasObjectStore((s) =>
        s.objects
            .filter(
                (o) =>
                    o.environmentId === envId &&
                    (o.category === OBJECT_CATEGORY.ZONE || o.category === OBJECT_CATEGORY.OBSTACLE),
            )
            .reduce((sum, o) => sum + computePolygonPerimeter(o.vertices), 0),
    );
    const totalVertices = useCanvasObjectStore((s) =>
        s.objects
            .filter(
                (o) =>
                    o.environmentId === envId &&
                    (o.category === OBJECT_CATEGORY.ZONE || o.category === OBJECT_CATEGORY.OBSTACLE),
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
