import ManageProvidersButton from "./ManageProvidersButton";
import PerformanceMonitorButton from "./PerformanceMonitorButton";
import BenchmarkButton from "./BenchmarkButton";
import MenuBarSubmenu from "@/components/menu-bar/MenuBarSubmenu";

export default function MenuBarRunSubmenu() {
    return (
        <MenuBarSubmenu>
            <BenchmarkButton />
            <ManageProvidersButton />
            <PerformanceMonitorButton />
        </MenuBarSubmenu>
    );
}
