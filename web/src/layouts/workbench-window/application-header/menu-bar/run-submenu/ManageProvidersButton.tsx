import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useComputationProvidersListModalStore } from "@/features/computation-provider/stores/computationProvidersListModalStore";

export default function ManageProvidersButton() {
    const open = useComputationProvidersListModalStore((s) => s.open);
    return <MenuBarItem label="Computation Providers..." onClick={open} />;
}
