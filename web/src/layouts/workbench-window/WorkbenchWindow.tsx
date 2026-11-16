import ConfirmationModal from "@/components/modals/confirmation-modal/ConfirmationModal";
import { useWorkbenchShortcuts } from "@/layouts/workbench-window/useWorkbenchShortcuts";
import BottomBar from "@/layouts/bottom-bar/BottomBar";
import CanvasArea from "./canvas/CanvasArea";
import RightPanel from "./right-panel/RightPanel";
import SettingsModal from "./settings/SettingsModal";
import SidePanel from "./side-panel/SidePanel";
import TopBar from "./top-bar/TopBar";

/** The shell: side panel on the left; top bar, canvas and right panel in the middle; the bottom bar under all of them. */
export default function WorkbenchWindow() {
  useWorkbenchShortcuts();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-page text-fg">
      <div className="flex min-h-0 flex-1">
        <SidePanel />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <CanvasArea />
            <RightPanel />
          </div>
        </div>
      </div>
      <BottomBar />
      <SettingsModal />
      <ConfirmationModal />
    </div>
  );
}
