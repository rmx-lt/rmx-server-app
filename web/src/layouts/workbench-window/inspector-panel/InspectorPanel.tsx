import UiInspectorPanel from "@/features/ui-manager/components/side-panels/UiInspectorPanel";
import InspectorPanelSection from "@/components/inspector-panel/InspectorPanelSection";
import InspectorPanelTabBar from "@/components/inspector-panel/InspectorPanelTabBar";
import MowingZoneSumField from "@/features/inspector/components/map-section/MowingZoneSumField";
import NoGoZoneSumField from "@/features/inspector/components/map-section/NoGoZoneSumField";
import VertexTotalField from "@/features/inspector/components/map-section/VertexTotalField";
import PerimeterLengthField from "@/features/inspector/components/map-section/PerimeterLengthField";
import DistanceBetweenVerticesField from "@/features/inspector/components/map-section/DistanceBetweenVerticesField";
import CategoryField from "@/features/inspector/components/object-section/CategoryField";
import VertexSumField from "@/features/inspector/components/object-section/VertexSumField";
import GrossAreaField from "@/features/inspector/components/object-section/GrossAreaField";
import NetAreaField from "@/features/inspector/components/object-section/NetAreaField";
import VertexPositionField from "@/features/inspector/components/point-section/VertexPositionField";
import SelectedVertexCountField from "../../../features/inspector/components/point-section/SelectedVertexCountField";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";

const INSPECTOR_TABS = [{ id: "details", label: "Details" }];

export default function InspectorPanel() {
  const hasSelection = useCanvasSelectionStore((s) => s.selectedObject !== null);
  const selectedVertexCount = useCanvasSelectionStore((s) => s.selectedVertexRefs.length);
  const hasAnyVertexSelection = useCanvasSelectionStore(
    (s) => s.selectedObject !== null && s.selectedVertexRefs.length > 0,
  );
  const hasSingleVertexSelection = hasAnyVertexSelection && selectedVertexCount === 1;
  const hasMultiVertexSelection = hasAnyVertexSelection && selectedVertexCount > 1;

  return (
    <UiInspectorPanel>
      <InspectorPanelTabBar
        tabs={INSPECTOR_TABS}
        activeTab="details"
        onTabChange={() => {}}
      />

      <div>
          {!hasSelection && !hasAnyVertexSelection && (
            <InspectorPanelSection title="Map">
              <MowingZoneSumField />
              <NoGoZoneSumField />
              <VertexTotalField />
              <PerimeterLengthField />
              <DistanceBetweenVerticesField />
            </InspectorPanelSection>
          )}

          {hasSelection && !hasAnyVertexSelection && (
            <InspectorPanelSection title="Zone">
              <CategoryField />
              <VertexSumField />
              <GrossAreaField />
              <NetAreaField />
            </InspectorPanelSection>
          )}

          {hasSingleVertexSelection && (
            <InspectorPanelSection title="Vertex">
              <VertexPositionField />
            </InspectorPanelSection>
          )}

          {hasMultiVertexSelection && (
            <InspectorPanelSection title="Vertices">
              <SelectedVertexCountField />
            </InspectorPanelSection>
          )}
      </div>
    </UiInspectorPanel>
  );
}

