import UiControlsPanel from "@/features/ui-manager/components/side-panels/UiControlsPanel";
import CoveragePlanningControlsPanel from "@/features/coverage-planning/components/controls-panel/CoveragePlanningControlsPanel";

export default function ControlsPanel() {
  return (
    <UiControlsPanel>
      <CoveragePlanningControlsPanel />
    </UiControlsPanel>
  );
}
