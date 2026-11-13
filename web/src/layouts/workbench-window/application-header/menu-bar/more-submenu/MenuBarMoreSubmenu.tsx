import type { ReactNode } from "react";
import type { MenuId } from "@/components/menu-bar/menuTypes";
import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import MenuBarSubmenu from "@/components/menu-bar/MenuBarSubmenu";

interface OverflowItem {
    menuId: MenuId;
    label: string;
    submenu: ReactNode;
}

interface Props {
    items: OverflowItem[];
}

export default function MenuBarMoreSubmenu({ items }: Props) {
    return (
        <MenuBarSubmenu>
            {items.map((item) => (
                <MenuBarItem key={item.menuId} label={item.label} submenu={item.submenu} />
            ))}
        </MenuBarSubmenu>
    );
}
