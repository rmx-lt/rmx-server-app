import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useCopyWorkspaceModalStore } from "@/features/workspace-manager/stores/copyWorkspaceModalStore";

export default function WorkspaceCopyButton() {
  const open = useCopyWorkspaceModalStore((s) => s.open);

  const handleClick = () => { open().catch(console.error); };

  return <MenuBarItem label="Make a Copy..." onClick={handleClick} />;
}
