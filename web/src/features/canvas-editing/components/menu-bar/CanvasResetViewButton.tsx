import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";

export default function CanvasResetViewButton() {
  const resetView = useCanvasViewStore((s) => s.resetView);

  return (
    <MenuBarItem label="Reset View" shortcut={S["canvas.reset-view"].shortcut} onClick={resetView} />
  );
}
