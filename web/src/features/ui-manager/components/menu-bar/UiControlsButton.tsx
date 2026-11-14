import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useUiControlsPanelStore } from "@/features/ui-manager/stores/uiControlsPanelStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function UiControlsButton() {
  const isVisible = useUiControlsPanelStore((state) => state.isVisible);
  const setVisibility = useUiControlsPanelStore((state) => state.setVisibility);

  return (
    <MenuBarItem
      label="Controls"
      shortcut={S["controls.toggle"].shortcut}
      hasCheckmark
      defaultChecked={isVisible}
      onClick={() => setVisibility(!isVisible)}
    />
  );
}
