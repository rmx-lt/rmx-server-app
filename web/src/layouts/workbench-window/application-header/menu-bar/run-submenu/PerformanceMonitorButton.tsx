import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { usePerformanceMonitorModalStore } from "@/components/chart/performanceMonitorModalStore";

export default function PerformanceMonitorButton() {
    const open = usePerformanceMonitorModalStore((s) => s.open);
    return <MenuBarItem label="Performance Monitor..." onClick={open} />;
}
