import UiStatusBar from "@/features/ui-manager/components/status-bar/UiStatusBar";
import SaveStateButton from "@/features/workspace-manager/components/status-bar/SaveStateButton";
import CanvasPointerPosition from "@/features/canvas-editing/components/status-bar/CanvasPointerPosition";
import CanvasGridScale from "@/features/canvas-editing/components/status-bar/CanvasGridScale";
import CanvasZoomLevel from "@/features/canvas-editing/components/status-bar/CanvasZoomLevel";
import UnitOfMeasureSelect from "@/features/ui-manager/components/status-bar/UnitOfMeasureSelect";
import StatusBarSeparator from "@/components/status-bar/StatusBarSeparator";

export default function StatusBar() {
  return (
    <UiStatusBar
      leftChildren={<SaveStateButton />}
      rightChildren={
        <>
          <UnitOfMeasureSelect />
          <StatusBarSeparator />
          <CanvasGridScale />
          <StatusBarSeparator />
          <CanvasZoomLevel />
          <StatusBarSeparator />
          <CanvasPointerPosition />
        </>
      }
    />
  );
}
