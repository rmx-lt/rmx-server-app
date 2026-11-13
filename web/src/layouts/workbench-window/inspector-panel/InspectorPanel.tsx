import UiInspectorPanel from "@/features/ui-manager/components/side-panels/UiInspectorPanel";
import InspectorPanelSection from "@/components/inspector-panel/InspectorPanelSection";
import InspectorPanelTabBar from "@/components/inspector-panel/InspectorPanelTabBar";
import ZoneSumField from "@/features/inspector/components/env-section/ZoneSumField";
import ObstacleSumField from "@/features/inspector/components/env-section/ObstacleSumField";
import VertexTotalField from "@/features/inspector/components/env-section/VertexTotalField";
import PerimeterLengthField from "@/features/inspector/components/env-section/PerimeterLengthField";
import DistanceBetweenVerticesField from "@/features/inspector/components/env-section/DistanceBetweenVerticesField";
import CategoryField from "@/features/inspector/components/object-section/CategoryField";
import TypeField from "@/features/inspector/components/object-section/TypeField";
import VertexSumField from "@/features/inspector/components/object-section/VertexSumField";
import GrossAreaField from "@/features/inspector/components/object-section/GrossAreaField";
import NetAreaField from "@/features/inspector/components/object-section/NetAreaField";
import CoverageField from "@/features/inspector/components/coverage-section/CoverageField";
import OverlapField from "@/features/inspector/components/coverage-section/OverlapField";
import TurnSumField from "@/features/inspector/components/coverage-section/TurnSumField";
import PathLengthField from "@/features/inspector/components/coverage-section/PathLengthField";
import EfficiencyField from "@/features/inspector/components/coverage-section/EfficiencyField";
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
  const hasEnvPointSelection = useCanvasSelectionStore((s) => s.selectedEnvPointType !== null);
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
          {!hasSelection && !hasEnvPointSelection && !hasAnyVertexSelection && (
            <InspectorPanelSection title="Environment">
              <ZoneSumField />
              <ObstacleSumField />
              <VertexTotalField />
              <PerimeterLengthField />
              <DistanceBetweenVerticesField />
            </InspectorPanelSection>
          )}

          {hasSelection && !hasEnvPointSelection && !hasAnyVertexSelection && (
            <InspectorPanelSection title="Object">
              <CategoryField />
              <TypeField />
              <VertexSumField />
              <GrossAreaField />
              <NetAreaField />
            </InspectorPanelSection>
          )}

          {hasEnvPointSelection && (
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

          {!hasSelection && !hasEnvPointSelection && !hasAnyVertexSelection && (
            <InspectorPanelSection title="Coverage">
              <CoverageField />
              <OverlapField />
              <EfficiencyField />
              <TurnSumField />
              <PathLengthField />
            </InspectorPanelSection>
          )}
        </div>
      )}

      {activeTab === "layers" && <LayersTab />}
    </UiInspectorPanel>
  );
}

