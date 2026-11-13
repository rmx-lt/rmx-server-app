import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useSaveModeStore } from "@/model/saveModeStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { saveCanvas } from "@/features/canvas-editing/data/canvasBridge";

export default function WorkspaceSaveButton() {
  const { mode, setMode, isAutoSaveEnabled } = useSaveModeStore();

  const handleClick = () => {
    saveCanvas()
      .then(() => {
        if (mode === "session") setMode(isAutoSaveEnabled ? "autosave" : "manual");
      })
      .catch(console.error);
  };

  return (
    <MenuBarItem label="Save" shortcut={S["workspace.save"].shortcut} onClick={handleClick} />
  );
}
