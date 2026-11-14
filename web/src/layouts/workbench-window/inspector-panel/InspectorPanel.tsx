import UiInspectorPanel from "@/features/ui-manager/components/side-panels/UiInspectorPanel";
import InspectorPanelSection from "@/components/inspector-panel/InspectorPanelSection";
import InspectorPanelTabBar from "@/components/inspector-panel/InspectorPanelTabBar";
import MowingZoneSumField from "@/features/inspector/components/map-section/MowingZoneSumField";
import NoGoZoneSumField from "@/features/inspector/components/map-section/NoGoZoneSumField";
import VertexTotalField from "@/features/inspector/components/map-section/VertexTotalField";
import PerimeterLengthField from "@/features/inspector/components/map-section/PerimeterLengthField";
import DistanceBetweenVerticesField from "@/features/inspector/components/map-section/DistanceBetweenVerticesField";
import CategoryField from "@/features/inspector/components/object-section/CategoryField";
import TypeField from "@/features/inspector/components/object-section/TypeField";
import VertexSumField from "@/features/inspector/components/object-section/VertexSumField";
import GrossAreaField from "@/features/inspector/components/object-section/GrossAreaField";
import NetAreaField from "@/features/inspector/components/object-section/NetAreaField";
import LayersTab from "@/features/inspector/components/calc-layers-section/LayersTab";
import PointTypeField from "@/features/inspector/components/point-section/PointTypeField";
import PointPositionField from "@/features/inspector/components/point-section/PointPositionField";
import SelectedVertexCountField from "../../../features/inspector/components/point-section/SelectedVertexCountField";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useInspectorTabStore } from "@/features/inspector/stores/inspectorTabStore";
import type { InspectorTab } from "@/features/inspector/stores/inspectorTabStore";

const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "layers", label: "Layers" },
];

export default function InspectorPanel() {
  const hasSelection = useCanvasSelectionStore((s) => s.selectedObject !== null);
  const hasMapPointSelection = useCanvasSelectionStore((s) => s.selectedMapPointType !== null);
  const selectedVertexCount = useCanvasSelectionStore((s) => s.selectedVertexRefs.length);
  const hasAnyVertexSelection = useCanvasSelectionStore(
    (s) => s.selectedObject !== null && s.selectedVertexRefs.length > 0,
  );
  const hasSingleVertexSelection = hasAnyVertexSelection && selectedVertexCount === 1;
  const hasMultiVertexSelection = hasAnyVertexSelection && selectedVertexCount > 1;
  const activeTab = useInspectorTabStore((s) => s.activeTab);
  const setActiveTab = useInspectorTabStore((s) => s.setActiveTab);

  return (
    <UiInspectorPanel>
      <InspectorPanelTabBar
        tabs={INSPECTOR_TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as InspectorTab)}
      />

      {activeTab === "details" && (
        <div>
          {!hasSelection && !hasMapPointSelection && !hasAnyVertexSelection && (
            <InspectorPanelSection title="Map">
              <MowingZoneSumField />
              <NoGoZoneSumField />
              <VertexTotalField />
              <PerimeterLengthField />
              <DistanceBetweenVerticesField />
            </InspectorPanelSection>
          )}

          {hasSelection && !hasMapPointSelection && !hasAnyVertexSelection && (
            <InspectorPanelSection title="Zone">
              <CategoryField />
              <TypeField />
              <VertexSumField />
              <GrossAreaField />
              <NetAreaField />
            </InspectorPanelSection>
          )}

          {hasMapPointSelection && (
            <InspectorPanelSection title="Point">
              <PointTypeField />
              <PointPositionField />
            </InspectorPanelSection>
          )}

          {hasSingleVertexSelection && (
            <InspectorPanelSection title="Vertex">
              <PointPositionField />
            </InspectorPanelSection>
          )}

          {hasMultiVertexSelection && (
            <InspectorPanelSection title="Vertices">
              <SelectedVertexCountField />
            </InspectorPanelSection>
          )}
        </div>
      )}

      {activeTab === "layers" && <LayersTab />}
    </UiInspectorPanel>
  );
}

