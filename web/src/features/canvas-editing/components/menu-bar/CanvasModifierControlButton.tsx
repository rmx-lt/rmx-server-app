import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useCanvasModifierFloatingControlStore } from "@/features/canvas-editing/stores/canvasModifierFloatingControlStore";

export default function CanvasModifierControlButton() {
    const isOpen = useCanvasModifierFloatingControlStore((s) => s.isOpen);
    const setOpen = useCanvasModifierFloatingControlStore((s) => s.setOpen);

    return (
        <MenuBarItem
            label="Modifier"
            hasCheckmark
            defaultChecked={isOpen}
            onClick={() => setOpen(!isOpen)}
        />
    );
}
