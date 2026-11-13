import CanvasResetViewButton from "@/features/canvas-editing/components/menu-bar/CanvasResetViewButton";
import CanvasZoomInButton from "@/features/canvas-editing/components/menu-bar/CanvasZoomInButton";
import CanvasZoomOutButton from "@/features/canvas-editing/components/menu-bar/CanvasZoomOutButton";
import CanvasToggleGridButton from "@/features/canvas-editing/components/menu-bar/CanvasToggleGridButton";
import MenuSeparator from "@/components/menu-bar/MenuBarSeparator";
import UiInspectorButton from "@/features/ui-manager/components/menu-bar/UiInspectorButton";
import UiControlsButton from "@/features/ui-manager/components/menu-bar/UiControlsButton";
import UiStatusBarButton from "@/features/ui-manager/components/menu-bar/UiStatusBarButton";
import CanvasModifierControlButton from "@/features/canvas-editing/components/menu-bar/CanvasModifierControlButton";
import CanvasGeneratorControlButton from "@/features/canvas-editing/components/menu-bar/CanvasGeneratorControlButton";
import GeoAnchorModalButton from "@/features/geo-anchor/components/menu-bar/GeoAnchorModalButton";
import CanvasHeatMapScaleButton from "@/features/canvas-editing/components/menu-bar/CanvasHeatMapScaleButton";
import MenuBarSubmenu from "@/components/menu-bar/MenuBarSubmenu";

export default function MenuBarViewSubmenu() {
  return (
    <MenuBarSubmenu>
      <CanvasResetViewButton />

      <MenuSeparator />

      <CanvasZoomInButton />
      <CanvasZoomOutButton />

      <MenuSeparator />

      <CanvasToggleGridButton />

      <MenuSeparator />

      <UiInspectorButton />
      <UiControlsButton />
      <UiStatusBarButton />

      <MenuSeparator />

      <CanvasModifierControlButton />
      <CanvasGeneratorControlButton />

      <MenuSeparator />

      <GeoAnchorModalButton />

      <MenuSeparator />

      <CanvasHeatMapScaleButton />
    </MenuBarSubmenu>
  );
}
