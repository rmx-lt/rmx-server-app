import MenuBarButton from "@/components/menu-bar/MenuBarButton";
import MenuBarRunSubmenu from "./MenuBarRunSubmenu";

export default function MenuBarRunButton() {
    return (
        <MenuBarButton
            menuId="run"
            label="Run"
            submenu={<MenuBarRunSubmenu />}
        />
    );
}
