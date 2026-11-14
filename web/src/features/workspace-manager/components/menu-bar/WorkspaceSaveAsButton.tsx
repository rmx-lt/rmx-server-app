import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useSaveAsModalStore } from "@/features/workspace-manager/stores/saveAsModalStore";

export default function WorkspaceSaveAsButton() {
  const open = useSaveAsModalStore((s) => s.open);

  const handleClick = () => {
    open().catch(console.error);
  };

  return (
    <MenuBarItem
      label="Save As..."
      shortcut={S["workspace.save-as"].shortcut}
      onClick={handleClick}
    />
  );
}
