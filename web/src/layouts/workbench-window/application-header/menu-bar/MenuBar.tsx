import { useEffect, useRef, useState } from "react";
import { useMenuStore } from "@/components/menu-bar/menuStore";
import MenuBarButton from "@/components/menu-bar/MenuBarButton";
import MenuBarFileSubmenu from "./file-submenu/MenuBarFileSubmenu";
import MenuBarEditSubmenu from "./edit-submenu/MenuBarEditSubmenu";
import MenuBarViewSubmenu from "./view-submenu/MenuBarViewSubmenu";
import MenuBarRunSubmenu from "./run-submenu/MenuBarRunSubmenu";
import MenuBarMoreButton from "./more-submenu/MenuBarMoreButton";
import type { MenuId } from "@/components/menu-bar/menuTypes";
import type { ReactNode } from "react";

interface MenuItem {
  menuId: MenuId;
  label: string;
  submenu: ReactNode;
}

const MENU_ITEMS: MenuItem[] = [
  { menuId: "file", label: "File", submenu: <MenuBarFileSubmenu /> },
  { menuId: "edit", label: "Edit", submenu: <MenuBarEditSubmenu /> },
  { menuId: "view", label: "View", submenu: <MenuBarViewSubmenu /> },
  { menuId: "run", label: "Run", submenu: <MenuBarRunSubmenu /> },
];

export default function MenuBar() {
  const menuBarRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const { setActiveMenu } = useMenuStore();
  const [allFit, setAllFit] = useState(true);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [setActiveMenu]);

  useEffect(() => {
    const container = menuBarRef.current;
    const ghost = ghostRef.current;
    if (!container || !ghost) return;

    function compute() {
      const needed = ghost!.getBoundingClientRect().width;
      const available = container!.getBoundingClientRect().width;
      setAllFit(needed <= available);
    }

    const observer = new ResizeObserver(compute);
    observer.observe(container);
    compute();

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={menuBarRef} className="relative flex items-center">
      {/* Ghost row: measures total natural button width without side-effects */}
      <div
        ref={ghostRef}
        className="absolute top-0 left-0 invisible pointer-events-none flex items-center"
        aria-hidden="true"
      >
        {MENU_ITEMS.map((item) => (
          <div key={item.menuId} className="flex items-center h-7 px-3 text-base select-none">
            {item.label}
          </div>
        ))}
      </div>

      {allFit
        ? MENU_ITEMS.map((item) => (
          <MenuBarButton
            key={item.menuId}
            menuId={item.menuId}
            label={item.label}
            submenu={item.submenu}
          />
        ))
        : <MenuBarMoreButton items={MENU_ITEMS} />}
    </div>
  );
}

