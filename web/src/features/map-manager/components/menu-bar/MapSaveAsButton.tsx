import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useSaveAsModalStore } from "@/features/map-manager/stores/saveAsModalStore";

export default function MapSaveAsButton() {
  const open = useSaveAsModalStore((s) => s.open);

  const handleClick = () => {
    open().catch(console.error);
  };

  return (
    <MenuBarItem
      label="Save As..."
      shortcut={S["map.save-as"].shortcut}
      onClick={handleClick}
    />
  );
}
