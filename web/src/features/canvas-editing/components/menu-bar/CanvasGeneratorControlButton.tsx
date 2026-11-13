import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useCanvasGeneratorFloatingControlStore } from "@/features/canvas-editing/stores/canvasGeneratorFloatingControlStore";

export default function CanvasGeneratorControlButton() {
    const isOpen = useCanvasGeneratorFloatingControlStore((s) => s.isOpen);
    const setOpen = useCanvasGeneratorFloatingControlStore((s) => s.setOpen);

    return (
        <MenuBarItem
            label="Generator"
            hasCheckmark
            defaultChecked={isOpen}
            onClick={() => setOpen(!isOpen)}
        />
    );
}
