import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useWorkspacePickerStore } from "@/features/workspace-manager/stores/workspacePickerStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function WorkspaceOpenButton() {
  const open = useWorkspacePickerStore((s) => s.open);

  return (
    <MenuBarItem
      label="Open..."
      shortcut={S["workspace.open"].shortcut}
      onClick={open}
    />
  );
}
