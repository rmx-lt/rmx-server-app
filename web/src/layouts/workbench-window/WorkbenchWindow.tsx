import ApplicationHeader from "./application-header/ApplicationHeader";
import ToolBar from "./tool-bar/ToolBar";
import ControlsPanel from "./controls-panel/ControlsPanel";
import InspectorPanel from "./inspector-panel/InspectorPanel";
import StatusBar from "./status-bar/StatusBar";
import CanvasEditorLayout from "./canvas-editor/CanvasEditorLayout";
import ConfirmationModal from "@/components/modals/confirmation-modal/ConfirmationModal";
import { useWorkbenchShortcuts } from "@/hooks/shortcut-manager/useWorkbenchShortcuts";
import WorkspacePickerModal from "@/features/workspace-manager/components/workspace-picker-modal/WorkspacePickerModal";
import SaveAsModal from "@/features/workspace-manager/components/save-as-modal/SaveAsModal";
import CopyWorkspaceModal from "@/features/workspace-manager/components/copy-workspace-modal/CopyWorkspaceModal";
import ImportModal from "@/features/workspace-manager/components/import-modal/ImportModal";
import GeoAnchorModal from "@/features/geo-anchor/components/GeoAnchorModal";

export default function WorkbenchWindow() {
  useWorkbenchShortcuts();

  return (
    <div className="flex flex-col w-full h-full">
      <ApplicationHeader />
      <ToolBar />
      <div className="relative flex-1 overflow-hidden">
        <CanvasEditorLayout />
        <div className="absolute inset-0 flex pointer-events-none z-10">
          <ControlsPanel />
          <div className="flex-1 select-none" />
          <InspectorPanel />
        </div>
      </div>
      <StatusBar />
      <WorkspacePickerModal />
      <ConfirmationModal />
      <SaveAsModal />
      <CopyWorkspaceModal />
      <ImportModal />
      <GeoAnchorModal />
    </div>
  );
}
