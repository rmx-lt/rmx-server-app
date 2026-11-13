import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { WORKBENCH_SHORTCUTS } from "@/config/shortcut-manager/workbenchShortcutsConfig";

const { shortcut } = WORKBENCH_SHORTCUTS["canvas.zoom-out"];

export default function CanvasZoomOutButton() {
  const zoomOut = useCanvasViewStore((s) => s.zoomOut);

  return <MenuBarItem label="Zoom Out" shortcut={shortcut} onClick={zoomOut} />;
}
