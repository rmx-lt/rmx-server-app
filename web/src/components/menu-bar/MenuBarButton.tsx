import type { ReactNode } from "react";
import type { MenuId } from "@/components/menu-bar/menuTypes";
import { useMenuStore } from "@/components/menu-bar/menuStore";

interface MenuBarButtonProps {
  menuId: MenuId;
  label: ReactNode;
  submenu: ReactNode;
  onClick?: () => void;
}

export default function MenuBarButton({
  menuId,
  label,
  submenu,
  onClick,
}: MenuBarButtonProps) {
  const { activeMenu, setActiveMenu } = useMenuStore();

  const isOpen = activeMenu === menuId;
  const isMenuMode = activeMenu !== null;

  const handleClick = () => {
    if (isOpen) {
      setActiveMenu(null);
    } else {
      setActiveMenu(menuId);
    }
    onClick?.();
  };

  const handleMouseEnter = () => {
    if (isMenuMode && activeMenu !== menuId) {
      setActiveMenu(menuId);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveMenu(null);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onKeyDown={handleKeyDown}
        className={`flex items-center h-7 px-3 text-base text-gray-700 rounded hover:bg-gray-200 active:bg-gray-300 cursor-pointer select-none ${isOpen ? "bg-gray-200" : ""}`}
      >
        {label}
      </button>

      {/* Submenu Dropdown */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-0 bg-white border border-gray-300 rounded shadow-lg z-20 min-w-max">
          {submenu}
        </div>
      )}
    </div>
  );
}
