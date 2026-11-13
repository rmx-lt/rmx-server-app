import MenuBarButton from "@/components/menu-bar/MenuBarButton";
import MenuBarFileSubmenu from "./MenuBarFileSubmenu";

export default function MenuBarFileButton() {
  return (
    <MenuBarButton
      menuId="file"
      label="File"
      submenu={<MenuBarFileSubmenu />}
    />
  );
}
