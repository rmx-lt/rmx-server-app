export type MenuId = "file" | "edit" | "view" | "more";

export interface MenuState {
  activeMenu: MenuId | null;
  setActiveMenu: (menuId: MenuId | null) => void;
}
