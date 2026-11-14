import ToggleToolBarButton from "@/components/tool-bar/ToolBarToggleButton";
import { useUiControlsPanelStore } from "@/features/ui-manager/stores/uiControlsPanelStore";

export default function UiControlsButton() {
  const isVisible = useUiControlsPanelStore((state) => state.isVisible);
  const setVisibility = useUiControlsPanelStore((state) => state.setVisibility);

  return (
    <ToggleToolBarButton
      titleOff="Expand controls panel"
      titleOn="Collapse controls panel"
      iconOff="left_panel_open"
      iconOn="left_panel_close"
      isToggled={isVisible}
      onChange={setVisibility}
    />
  );
}
