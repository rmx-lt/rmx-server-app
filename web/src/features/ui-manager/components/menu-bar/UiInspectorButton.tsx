import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useUiInspectorPanelStore } from "@/features/ui-manager/stores/uiInspectorPanelStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function UiInspectorButton() {
  const isVisible = useUiInspectorPanelStore((state) => state.isVisible);
  const setVisibility = useUiInspectorPanelStore(
    (state) => state.setVisibility,
  );

  return (
    <MenuBarItem
      label="Inspector"
      shortcut={S["inspector.toggle"].shortcut}
      hasCheckmark
      defaultChecked={isVisible}
      onClick={() => setVisibility(!isVisible)}
    />
  );
}
