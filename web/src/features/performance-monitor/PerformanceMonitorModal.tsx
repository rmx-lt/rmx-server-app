import { useEffect, useMemo, useState } from "react";
import {
    usePerformanceMonitorModalStore,
    DEFAULT_CHART_WIDTH,
    MODAL_CHROME_W,
} from "@/components/chart/performanceMonitorModalStore";
import { useComputeResultStore } from "@/model/useComputeResultStore";
import { useComputationCatalogStore } from "@/model/computationCatalogStore";
import ModalTitle from "@/components/modal/modal-title/ModalTitle";
import ModalFooterButton from "@/components/modal/modal-footer/ModalFooterButton";
import CardModalField from "@/components/modals/card-modal/CardModalField";
import type { BarChartItem, PerformanceMetric, PerformanceMetricStage } from "@/data/local/serviceTypes";
import ChartCard from "@/components/chart/ChartCard";
import BarChartCard from "@/components/chart/BarChartCard";

export default function PerformanceMonitorModal() {
    const { isOpen, close, chartSizes, initChartSizes } = usePerformanceMonitorModalStore();
    const result = useComputeResultStore((s) => s.result);
    const allMetrics = useComputationCatalogStore((s) => s.metrics);

    // Derive grouped metrics from result + metadata
    const { groups, metricsByGroup } = useMemo(() => {
        if (!result) return { groups: [], metricsByGroup: new Map() };

        const { algorithmId, providerId } = result;
        const performanceValues = result.result.performance?.metrics ?? [];

        // Filter metadata for this algorithm, sorted by id ascending
        const metaMapped = allMetrics
            .filter((m) => m.algorithmId === algorithmId && m.computationProviderId === providerId)
            .sort((a, b) => a.id - b.id);

        // Build a lookup from id → metric payload
        const valueById = new Map<number, PerformanceMetric>();
        for (const pv of performanceValues) {
            valueById.set(pv.id, pv);
        }

        // Group — preserving first-appearance order
        const groupOrder: string[] = [];
        const byGroup = new Map<string, { id: number; name: string; type: string; value: PerformanceMetric["value"] | undefined; stages?: PerformanceMetricStage[]; style?: { xAxisLabel?: string; yAxisLabel?: string } }[]>();

        for (const meta of metaMapped) {
            const group = meta.group ?? "General";
            if (!byGroup.has(group)) {
                groupOrder.push(group);
                byGroup.set(group, []);
            }
            const metric = valueById.get(meta.id);
            byGroup.get(group)!.push({
                id: meta.id,
                name: meta.name,
                type: meta.type,
                value: metric?.value,
                stages: metric?.stages,
                style: meta.style,
            });
        }

        return { groups: groupOrder, metricsByGroup: byGroup };
    }, [result, allMetrics]);

    const [activeGroup, setActiveGroup] = useState<string | null>(null);

    // Reset active group when modal opens / groups change
    useEffect(() => {
        if (isOpen) {
            setActiveGroup(groups[0] ?? null);
            void initChartSizes();
        }
    }, [isOpen, groups, initChartSizes]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [isOpen, close]);

    if (!isOpen) return null;

    const activeMetrics = activeGroup ? (metricsByGroup.get(activeGroup) ?? []) : [];

    const renderContent = () => {
        if (!result) {
            return (
                <div className="flex items-center justify-center flex-1 text-sm text-gray-400 select-none">
                    No computation results available.
                </div>
            );
        }
        if (groups.length === 0) {
            return (
                <div className="flex items-center justify-center flex-1 text-sm text-gray-400 select-none">
                    No performance metrics for this result.
                </div>
            );
        }
        return (
            <>
                {/* Tab bar */}
                <div className="flex shrink-0 border-b border-gray-300 bg-gray-100">
                    {groups.map((group) => {
                        const isActive = group === activeGroup;
                        return (
                            <button
                                key={group}
                                type="button"
                                onClick={() => setActiveGroup(group)}
                                className={`px-4 py-2 text-sm font-medium transition-colors focus:outline-none border-b-2 -mb-px
                                    ${isActive
                                        ? "border-teal-600 text-teal-700"
                                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                                    }`}
                            >
                                {group}
                            </button>
                        );
                    })}
                </div>

                {/* Metrics list */}
                <div className="flex-1 overflow-y-auto">
                    <div className="px-4 py-2 flex flex-col gap-2">
                        {activeMetrics.map((metric: { id: number; name: string; type: string; value: PerformanceMetric["value"] | undefined; stages?: PerformanceMetricStage[]; style?: { xAxisLabel?: string; yAxisLabel?: string } }) => {
                            if (metric.type === "Time-series") {
                                const data = (Array.isArray(metric.value) ? metric.value : []) as Array<number | { x: number; y: number }>;
                                return (
                                    <ChartCard
                                        key={metric.id}
                                        metricId={metric.id}
                                        name={metric.name}
                                        series={[{ label: metric.name, data }]}
                                        stages={metric.stages}
                                        xAxisLabel={metric.style?.xAxisLabel}
                                        yAxisLabel={metric.style?.yAxisLabel}
                                    />
                                );
                            }
                            if (metric.type === "Bar-chart") {
                                const items = Array.isArray(metric.value) ? metric.value as BarChartItem[] : [];
                                return (
                                    <BarChartCard
                                        key={metric.id}
                                        metricId={metric.id}
                                        name={metric.name}
                                        items={items}
                                        xAxisLabel={metric.style?.xAxisLabel}
                                        yAxisLabel={metric.style?.yAxisLabel}
                                    />
                                );
                            }
                            const value = typeof metric.value === "number" ? metric.value : null;
                            return (
                                <CardModalField
                                    key={metric.id}
                                    id={String(metric.id)}
                                    label={metric.name}
                                    value={value !== null ? String(value) : "—"}
                                    disabled
                                />
                            );
                        })}
                    </div>
                </div>
            </>
        );
    };

    return (
        <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 select-none"
            onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
            <div
                data-performance-modal
                className="max-h-[80vh] flex flex-col bg-white rounded-lg shadow-xl overflow-hidden"
                style={{
                    width: Math.max(DEFAULT_CHART_WIDTH, ...Object.values(chartSizes).map((s) => s.width)) + MODAL_CHROME_W,
                    maxWidth: "90vw",
                }}
            >
                {/* Header */}
                <div className="border-b border-gray-200 shrink-0">
                    <ModalTitle title="Performance Monitor" onClose={close} />
                </div>

                {/* Body */}
                <div className="flex flex-col flex-1 min-h-0">
                    {renderContent()}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 shrink-0">
                    <ModalFooterButton onClick={close}>Close</ModalFooterButton>
                </div>
            </div>
        </div>
    );
}
