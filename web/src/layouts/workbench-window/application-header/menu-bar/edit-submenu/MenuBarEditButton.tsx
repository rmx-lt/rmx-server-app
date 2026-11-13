import MenuBarButton from "@/components/menu-bar/MenuBarButton";
import MenuBarEditSubmenu from "./MenuBarEditSubmenu";

export default function MenuBarEditButton() {
    return (
        <MenuBarButton
            menuId="edit"
            label="Edit"
            submenu={<MenuBarEditSubmenu />}
        />
    );
}
