import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { WORKBENCH_SHORTCUTS } from "@/config/shortcut-manager/workbenchShortcutsConfig";

const { shortcut } = WORKBENCH_SHORTCUTS["canvas.zoom-in"];

export default function CanvasZoomInButton() {
  const zoomIn = useCanvasViewStore((s) => s.zoomIn);

  return <MenuBarItem label="Zoom In" shortcut={shortcut} onClick={zoomIn} />;
}
