import MenuBarButton from "@/components/menu-bar/MenuBarButton";
import MenuBarMoreSubmenu from "./MenuBarMoreSubmenu";
import type { MenuId } from "@/components/menu-bar/menuTypes";
import type { ReactNode } from "react";

interface OverflowItem {
    menuId: MenuId;
    label: string;
    submenu: ReactNode;
}

interface Props {
    items: OverflowItem[];
}

export default function MenuBarMoreButton({ items }: Props) {
    return (
        <MenuBarButton
            menuId="more"
            label={<span className="material-symbols-outlined" style={{ fontSize: 20 }}>menu</span>}
            submenu={<MenuBarMoreSubmenu items={items} />}
        />
    );
}
