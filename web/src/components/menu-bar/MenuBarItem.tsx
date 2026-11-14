import { useState } from "react";
import type { ReactNode } from "react";
import { useMenuStore } from "@/components/menu-bar/menuStore";

interface MenuBarItemProps {
  label: string;
  hasCheckmark?: boolean;
  defaultChecked?: boolean;
  shortcut?: string[];
  submenu?: ReactNode;
  onClick?: () => void;
}

export default function MenuBarItem({
  label,
  hasCheckmark,
  defaultChecked = false,
  shortcut,
  submenu,
  onClick,
}: MenuBarItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [checked, setChecked] = useState(defaultChecked);
  const { setActiveMenu } = useMenuStore();

  const hasSubmenu = !!submenu;
  const shortcutText = shortcut?.join("+") || "";

  const handleClick = () => {
    if (!hasSubmenu) {
      setActiveMenu(null);
    }

    if (hasCheckmark) {
      setChecked(!checked);
    }
    onClick?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveMenu(null);
    }
  };

  return (
    <div
      className="relative px-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-2 px-3 w-full max-w-72 text-left text-base text-gray-700 hover:bg-gray-200 rounded cursor-pointer select-none"
      >
        {/* Left: Checkmark space */}
        <div className="w-5 shrink-0">
          {hasCheckmark && (
            <span className="text-base leading-none">
              {checked ? "✓" : " "}
            </span>
          )}
        </div>

        {/* Center: Label */}
        <span className="flex-1 pr-8 truncate min-w-0">{label}</span>

        {/* Right: Shortcut or Arrow */}
        {(shortcutText || hasSubmenu) && (
          <div className="flex items-center text-gray-500 shrink-0">
            {hasSubmenu ? (
              <span className="material-symbols-outlined block leading-none" style={{ fontSize: 18 }}>chevron_right</span>
            ) : <span className="text-base">{shortcutText}</span>}
          </div>
        )}
      </button>

      {/* Submenu */}
      {hasSubmenu && isHovered && (
        <div className="absolute left-full -top-1.25 min-w-max bg-white border border-gray-300 rounded shadow-lg z-10">
          {submenu}
        </div>
      )}
    </div>
  );
}
