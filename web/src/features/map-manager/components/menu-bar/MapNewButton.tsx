import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { newMap } from "@/features/map-manager/data/mapBridge";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function MapNewButton() {
  function handleClick() {
    newMap().catch(console.error);
  }

  return (
    <MenuBarItem
      label="New..."
      shortcut={S["map.new"].shortcut}
      onClick={handleClick}
    />
  );
}
