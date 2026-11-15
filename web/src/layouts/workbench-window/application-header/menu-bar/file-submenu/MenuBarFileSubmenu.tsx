import MapNewButton from "@/features/map-manager/components/menu-bar/MapNewButton";
import MapRenameButton from "@/features/map-manager/components/menu-bar/MapRenameButton";
import MapDuplicateButton from "@/features/map-manager/components/menu-bar/MapDuplicateButton";
import MenuSeparator from "@/components/menu-bar/MenuBarSeparator";
import MapOpenButton from "@/features/map-manager/components/menu-bar/MapOpenButton";
import MenuBarSubmenu from "@/components/menu-bar/MenuBarSubmenu";

export default function MenuBarFileSubmenu() {
  return (
    <MenuBarSubmenu>
      <MapNewButton />
      <MapOpenButton />

      <MenuSeparator />

      <MapRenameButton />
      <MapDuplicateButton />
    </MenuBarSubmenu>
  );
}
