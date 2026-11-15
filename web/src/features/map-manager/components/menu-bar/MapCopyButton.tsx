import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useCopyMapModalStore } from "@/features/map-manager/stores/copyMapModalStore";

export default function MapCopyButton() {
  const open = useCopyMapModalStore((s) => s.open);

  const handleClick = () => { open().catch(console.error); };

  return <MenuBarItem label="Make a Copy..." onClick={handleClick} />;
}
