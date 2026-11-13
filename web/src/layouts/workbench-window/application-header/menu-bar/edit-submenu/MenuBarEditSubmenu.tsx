import CanvasUndoButton from "@/features/canvas-editing/components/menu-bar/CanvasUndoButton";
import CanvasRedoButton from "@/features/canvas-editing/components/menu-bar/CanvasRedoButton";
import MenuBarSubmenu from "@/components/menu-bar/MenuBarSubmenu";

export default function MenuBarEditSubmenu() {
    return (
        <MenuBarSubmenu>
            <CanvasUndoButton />
            <CanvasRedoButton />
        </MenuBarSubmenu>
    );
}
