import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Chart as ChartJS,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    type ChartOptions,
    type Plugin,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import CardModalField from "@/components/modals/card-modal/CardModalField";
import type { BarChartItem } from "@/data/local/serviceTypes";
import {
    usePerformanceMonitorModalStore,
    DEFAULT_CHART_WIDTH,
    DEFAULT_CHART_HEIGHT,
} from "@/components/chart/performanceMonitorModalStore";
import { useChartResize } from "@/components/chart/useChartResize";

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const BAR_COLORS = [
    "#0d9488",
    "#3b82f6",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#84cc16",
    "#06b6d4",
    "#f97316",
    "#14b8a6",
];

const barBorderBoxPlugin: Plugin<"bar"> = {
    id: "barBorderBox",
    afterDraw(chart) {
        const { ctx, chartArea: { left, top, right, bottom } } = chart;
        ctx.save();
        ctx.strokeStyle = "#9ca3af";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(right, top);
        ctx.lineTo(right, bottom);
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
        ctx.stroke();
        ctx.restore();
    },
};

interface BarChartCardProps {
    metricId: number;
    name: string;
    items: BarChartItem[];
    xAxisLabel?: string;
    yAxisLabel?: string;
}

export default function BarChartCard({ metricId, name, items, xAxisLabel, yAxisLabel }: BarChartCardProps) {
    const chartRef = useRef<ChartJS<"bar"> | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const effectiveTitleRef = useRef(name);
    const [isLabelEditorOpen, setIsLabelEditorOpen] = useState(false);
    const [titleOverride, setTitleOverride] = useState(name);
    const [xAxisLabelOverride, setXAxisLabelOverride] = useState(xAxisLabel ?? "Category");
    const [yAxisLabelOverride, setYAxisLabelOverride] = useState(yAxisLabel ?? "Value");

    useEffect(() => {
        setTitleOverride(name);
    }, [name]);

    useEffect(() => {
        setXAxisLabelOverride(xAxisLabel ?? "Category");
    }, [xAxisLabel]);

    useEffect(() => {
        setYAxisLabelOverride(yAxisLabel ?? "Value");
    }, [yAxisLabel]);

    const effectiveTitle = titleOverride.trim() || name;
    const effectiveXAxisLabel = xAxisLabelOverride.trim() || (xAxisLabel ?? "Category");
    const effectiveYAxisLabel = yAxisLabelOverride.trim() || (yAxisLabel ?? "Value");

    useEffect(() => {
        effectiveTitleRef.current = effectiveTitle;
    }, [effectiveTitle]);

    useEffect(() => {
        if (chartRef.current) {
            const chart = chartRef.current;
            const xScale = chart.options.scales?.x;
            const yScale = chart.options.scales?.y;
            if (xScale && "title" in xScale && xScale.title) {
                (xScale.title as { text?: string }).text = effectiveXAxisLabel;
            }
            if (yScale && "title" in yScale && yScale.title) {
                (yScale.title as { text?: string }).text = effectiveYAxisLabel;
            }
            chart.update("none");
        }
    }, [effectiveXAxisLabel, effectiveYAxisLabel]);

    const axisNumberFormatter = useMemo(
        () => new Intl.NumberFormat("fr-FR", { useGrouping: true, maximumFractionDigits: 4 }),
        [],
    );

    const formatAxisTick = useCallback(
        (value: string | number) => {
            const numericValue = typeof value === "number" ? value : Number(value);
            if (!Number.isFinite(numericValue)) return String(value);
            return axisNumberFormatter.format(numericValue).replace(/[\u00A0\u202F]/g, " ");
        },
        [axisNumberFormatter],
    );

    const { chartSizes, setChartSize, persistChartSizes } = usePerformanceMonitorModalStore();
    const { width: chartWidth, height: chartHeight } =
        chartSizes[metricId] ?? { width: DEFAULT_CHART_WIDTH, height: DEFAULT_CHART_HEIGHT };

    const { handleResizePointerDown, isDragging } = useChartResize({
        metricId,
        chartSizes,
        setChartSize,
        persistChartSizes,
        chartRef,
        containerRef,
    });

    const titlePlugin = useMemo<Plugin<"bar">>(
        () => ({
            id: `barCenterTitle-${metricId}`,
            beforeDraw(chart) {
                const { ctx, chartArea: { left, right, top } } = chart;
                ctx.save();
                ctx.fillStyle = "#374151";
                ctx.font = "bold 16px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "bottom";
                const maxWidth = right - left;
                let label = effectiveTitleRef.current;
                if (ctx.measureText(label).width > maxWidth) {
                    while (label.length > 0 && ctx.measureText(label + "…").width > maxWidth) {
                        label = label.slice(0, -1);
                    }
                    label += "…";
                }
                ctx.fillText(label, (left + right) / 2, top - 4);
                ctx.restore();
            },
        }),
        [metricId],
    );

    const handleDownload = useCallback(async () => {
        if (!chartRef.current) return;
        const src = chartRef.current.canvas;
        const dpr = window.devicePixelRatio || 1;

        const EXPORT_PAD_X = 20;
        const EXPORT_PAD_Y = 20;

        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = src.width + EXPORT_PAD_X * 2 * dpr;
        exportCanvas.height = src.height + EXPORT_PAD_Y * 2 * dpr;

        const ctx = exportCanvas.getContext("2d");
        if (!ctx) return;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        ctx.drawImage(src, EXPORT_PAD_X * dpr, EXPORT_PAD_Y * dpr, src.width, src.height);

        await new Promise<void>((resolve) => {
            exportCanvas.toBlob((blob) => {
                if (!blob) { resolve(); return; }
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${effectiveTitleRef.current || "chart"}.png`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                resolve();
            }, "image/png");
        });
    }, [chartRef]);

    const handleCsvExport = useCallback(async () => {
        const xLabel = effectiveXAxisLabel;
        const yLabel = effectiveYAxisLabel;
        const header = `${xLabel},${yLabel}`;
        const rows = items.map((item) => `${item.label},${item.duration}`);
        const csv = [header, ...rows].join("\n");

        const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${effectiveTitleRef.current || "chart"}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, [items, effectiveXAxisLabel, effectiveYAxisLabel]);

    const chartData = useMemo(
        () => ({
            labels: items.map((item) => item.label),
            datasets: [
                {
                    label: effectiveTitle,
                    data: items.map((item) => item.duration),
                    backgroundColor: items.map((_, i) => BAR_COLORS[i % BAR_COLORS.length] + "cc"),
                    borderColor: items.map((_, i) => BAR_COLORS[i % BAR_COLORS.length]),
                    borderWidth: 1,
                    borderRadius: 3,
                },
            ],
        }),
        [items, effectiveTitle],
    );

    const maxValue = useMemo(
        () => (items.length > 0 ? Math.max(...items.map((i) => i.duration)) : null),
        [items],
    );

    const minValue = useMemo(
        () => (items.length > 0 ? Math.min(...items.map((i) => i.duration)) : null),
        [items],
    );

    const options = useMemo<ChartOptions<"bar">>(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: { padding: { top: 22 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (item) => {
                            const val = item.parsed.y;
                            return ` ${formatAxisTick(val ?? 0)} ${effectiveYAxisLabel}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: effectiveXAxisLabel, font: { size: 14, weight: "bold" }, color: "#4b5563" },
                    ticks: { font: { size: 13, weight: "bold" }, color: "#4b5563", maxRotation: 30 },
                    grid: { color: "#e5e7eb" },
                    border: { color: "#9ca3af" },
                },
                y: {
                    title: { display: true, text: effectiveYAxisLabel, font: { size: 14, weight: "bold" }, color: "#4b5563" },
                    ticks: { font: { size: 14, weight: "bold" }, color: "#4b5563", callback: (value) => formatAxisTick(value as number) },
                    grid: { color: "#e5e7eb" },
                    border: { color: "#9ca3af" },
                    beginAtZero: true,
                },
            },
        }),
        [effectiveXAxisLabel, effectiveYAxisLabel, formatAxisTick],
    );

    return (
        <div className="px-4 py-3 border-b border-gray-200 last:border-b-0">
            <div className="relative mx-auto mb-7" ref={containerRef} style={{ width: chartWidth, height: chartHeight }}>
                <Bar
                    ref={chartRef}
                    data={chartData}
                    options={options}
                    plugins={[barBorderBoxPlugin, titlePlugin]}
                />
                <span
                    onClick={handleCsvExport}
                    title="Export CSV"
                    className="material-symbols-outlined absolute right-15 cursor-pointer select-none leading-none z-10 text-gray-300 hover:text-gray-600"
                    style={{ fontSize: 16, bottom: "-12px" }}
                >
                    table_chart
                </span>
                <span
                    onClick={handleDownload}
                    title="Export PNG"
                    className="material-symbols-outlined absolute right-10 cursor-pointer select-none leading-none z-10 text-gray-300 hover:text-gray-600"
                    style={{ fontSize: 16, bottom: "-12px" }}
                >
                    download
                </span>
                <span
                    onClick={() => setIsLabelEditorOpen((prev) => !prev)}
                    title="Edit labels"
                    className={`material-symbols-outlined absolute right-5 cursor-pointer select-none leading-none z-10 ${isLabelEditorOpen ? "text-gray-600" : "text-gray-300 hover:text-gray-600"}`}
                    style={{ fontSize: 16, bottom: "-12px" }}
                >
                    edit_note
                </span>
                <span
                    onPointerDown={handleResizePointerDown}
                    title="Resize"
                    className={`material-symbols-outlined absolute right-0 cursor-se-resize select-none leading-none rotate-270 z-10 ${isDragging ? "text-gray-600" : "text-gray-300 hover:text-gray-600"}`}
                    style={{ fontSize: 16, bottom: "-12px" }}
                >
                    resize_window
                </span>
            </div>
            {isLabelEditorOpen && (
                <div className="mx-auto mt-2 rounded border border-gray-200 bg-white px-3 py-2" style={{ width: chartWidth }}>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                            Title
                            <input
                                type="text"
                                value={titleOverride}
                                onChange={(e) => setTitleOverride(e.target.value)}
                                className="h-8 rounded border border-gray-300 px-2 text-xs text-gray-800 outline-none focus:border-teal-500"
                                placeholder={name}
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                            X axis label
                            <input
                                type="text"
                                value={xAxisLabelOverride}
                                onChange={(e) => setXAxisLabelOverride(e.target.value)}
                                className="h-8 rounded border border-gray-300 px-2 text-xs text-gray-800 outline-none focus:border-teal-500"
                                placeholder={xAxisLabel ?? "Category"}
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                            Y axis label
                            <input
                                type="text"
                                value={yAxisLabelOverride}
                                onChange={(e) => setYAxisLabelOverride(e.target.value)}
                                className="h-8 rounded border border-gray-300 px-2 text-xs text-gray-800 outline-none focus:border-teal-500"
                                placeholder={yAxisLabel ?? "Value"}
                            />
                        </label>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setTitleOverride(name);
                                setXAxisLabelOverride(xAxisLabel ?? "Category");
                                setYAxisLabelOverride(yAxisLabel ?? "Value");
                            }}
                            className="rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsLabelEditorOpen(false)}
                            className="rounded border border-teal-600 bg-teal-600 px-2 py-1 text-xs font-semibold text-white hover:bg-teal-700"
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}
            <div className="flex flex-col gap-2 mt-2">
                <CardModalField id="min" label="Min" value={minValue !== null ? formatAxisTick(minValue) : "—"} disabled />
                <CardModalField id="max" label="Max" value={maxValue !== null ? formatAxisTick(maxValue) : "—"} disabled />
            </div>
        </div>
    );
}
