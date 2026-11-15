import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { duplicateMap } from "@/features/map-manager/data/mapBridge";

export default function MapDuplicateButton() {
  return <MenuBarItem label="Duplicate" onClick={() => void duplicateMap().catch(console.error)} />;
}
