import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useSaveModalStore } from "@/features/workspace-manager/stores/saveModalStore";
import { resetWorkspace } from "@/features/workspace-manager/data/workspaceBridge";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function WorkspaceNewButton() {
  function handleClick() {
    useSaveModalStore.getState().requestWithSaveGuard(resetWorkspace);
  }

  return (
    <MenuBarItem
      label="New..."
      shortcut={S["workspace.new"].shortcut}
      onClick={handleClick}
    />
  );
}
