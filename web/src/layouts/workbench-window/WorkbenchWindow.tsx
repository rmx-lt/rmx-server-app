import ConfirmationModal from "@/components/modals/confirmation-modal/ConfirmationModal";
import { useWorkbenchShortcuts } from "@/layouts/workbench-window/useWorkbenchShortcuts";
import CanvasArea from "./canvas/CanvasArea";
import RightPanel from "./right-panel/RightPanel";
import SettingsModal from "./settings/SettingsModal";
import SidePanel from "./side-panel/SidePanel";
import TopBar from "./top-bar/TopBar";

/** The shell: side panel on the left, top bar and canvas in the middle, right panel on the right. */
export default function WorkbenchWindow() {
  useWorkbenchShortcuts();

  return (
    <div className="flex h-full w-full overflow-hidden bg-page text-fg">
      <SidePanel />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <CanvasArea />
      </div>
      <RightPanel />
      <SettingsModal />
      <ConfirmationModal />
    </div>
  );
}
