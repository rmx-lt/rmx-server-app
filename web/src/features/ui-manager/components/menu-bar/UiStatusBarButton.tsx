import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useUiStatusBarStore } from "@/features/ui-manager/stores/uiStatusBarStore";

export default function UiStatusBarButton() {
  const isVisible = useUiStatusBarStore((state) => state.isVisible);
  const setVisibility = useUiStatusBarStore((state) => state.setVisibility);

  return (
    <MenuBarItem
      label="Status Bar"
      hasCheckmark
      defaultChecked={isVisible}
      onClick={() => setVisibility(!isVisible)}
    />
  );
}
