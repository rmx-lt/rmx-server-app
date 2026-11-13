import { create } from "zustand";
import type { MenuId, MenuState } from "@/components/menu-bar/menuTypes";

export const useMenuStore = create<MenuState>((set) => ({
  activeMenu: null,

  setActiveMenu: (menuId: MenuId | null) =>
    set(() => ({
      activeMenu: menuId,
    })),
}));
