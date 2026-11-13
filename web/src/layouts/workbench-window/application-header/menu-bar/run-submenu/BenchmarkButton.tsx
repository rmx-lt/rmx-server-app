import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useBenchmarkModalStore } from "@/features/benchmark-manager/stores/benchmarkModalStore";

export default function BenchmarkButton() {
    const open = useBenchmarkModalStore((s) => s.open);
    return <MenuBarItem label="Benchmark..." onClick={open} />;
}
