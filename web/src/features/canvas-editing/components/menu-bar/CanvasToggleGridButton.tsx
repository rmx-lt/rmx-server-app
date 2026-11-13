import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useLayerSettingsStore, getLayerParam } from "@/model/layerSettingsStore";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/config/layers/layerRegistry";

export default function CanvasToggleGridButton() {
  const layers = useLayerSettingsStore((s) => s.layers);
  const setVisible = useLayerSettingsStore((s) => s.setVisible);

  const gridVisible = getLayerParam(layers, LAYER_ID.GRID, LAYER_PARAM_KEY.VISIBLE) !== "false";

  return (
    <MenuBarItem
      label="Toggle Grid"
      hasCheckmark
      defaultChecked={gridVisible}
      onClick={() => setVisible({ id: LAYER_ID.GRID, algorithmId: 0, providerId: 0 }, !gridVisible)}
    />
  );
}
