import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useCanvasHeatMapScaleFloatingControlStore } from "@/features/canvas-editing/stores/canvasHeatMapScaleFloatingControlStore";

export default function CanvasHeatMapScaleButton() {
    const isOpen = useCanvasHeatMapScaleFloatingControlStore((s) => s.isOpen);
    const setOpen = useCanvasHeatMapScaleFloatingControlStore((s) => s.setOpen);

    return (
        <MenuBarItem
            label="Heat Map Scale"
            hasCheckmark
            defaultChecked={isOpen}
            onClick={() => setOpen(!isOpen)}
        />
    );
}
