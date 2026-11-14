import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useMapPickerStore } from "@/features/map-manager/stores/mapPickerStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function MapOpenButton() {
  const open = useMapPickerStore((s) => s.open);

  return (
    <MenuBarItem
      label="Open..."
      shortcut={S["map.open"].shortcut}
      onClick={open}
    />
  );
}
