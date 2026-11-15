import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useSaveModalStore } from "@/features/map-manager/stores/saveModalStore";
import { resetMap } from "@/features/map-manager/data/mapBridge";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function MapNewButton() {
  function handleClick() {
    useSaveModalStore.getState().requestWithSaveGuard(resetMap);
  }

  return (
    <MenuBarItem
      label="New..."
      shortcut={S["map.new"].shortcut}
      onClick={handleClick}
    />
  );
}
