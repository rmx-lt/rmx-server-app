import MapNewButton from "@/features/map-manager/components/menu-bar/MapNewButton";
import MapSaveButton from "@/features/map-manager/components/menu-bar/MapSaveButton";
import MapSaveAsButton from "@/features/map-manager/components/menu-bar/MapSaveAsButton";
import MapRenameButton from "@/features/map-manager/components/menu-bar/MapRenameButton";
import MapCopyButton from "@/features/map-manager/components/menu-bar/MapCopyButton";
import MapImportButton from "@/features/map-manager/components/menu-bar/MapImportButton";
import MapExportButton from "@/features/map-manager/components/menu-bar/MapExportButton";
// import MapCloseButton from "@/features/map-manager/components/menu-bar/MapCloseButton";
import MenuSeparator from "@/components/menu-bar/MenuBarSeparator";
import MapOpenButton from "@/features/map-manager/components/menu-bar/MapOpenButton";
import MapAutoSaveButton from "@/features/map-manager/components/menu-bar/MapAutoSaveButton";
import MenuBarSubmenu from "@/components/menu-bar/MenuBarSubmenu";

export default function MenuBarFileSubmenu() {
  return (
    <MenuBarSubmenu>
      <MapNewButton />
      <MapOpenButton />

      <MenuSeparator />

      <MapSaveButton />
      <MapSaveAsButton />

      <MenuSeparator />

      <MapRenameButton />
      <MapCopyButton />

      <MenuSeparator />

      <MapAutoSaveButton />

      <MenuSeparator />

      <MapImportButton />
      <MapExportButton />

      {/* TODO: Home screen */}
      {/* <MenuSeparator />

      <MapCloseButton /> */}
    </MenuBarSubmenu>
  );
}
