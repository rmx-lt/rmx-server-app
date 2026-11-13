import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    LogarithmicScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    type ChartOptions,
    type Plugin,
} from "chart.js";
import { Line } from "react-chartjs-2";
import CardModalField from "@/components/modals/card-modal/CardModalField";
import type { PerformanceMetricStage } from "@/data/local/serviceTypes";
import {
    usePerformanceMonitorModalStore,
    DEFAULT_CHART_WIDTH,
    DEFAULT_CHART_HEIGHT,
} from "@/components/chart/performanceMonitorModalStore";
import { useChartResize } from "@/components/chart/useChartResize";

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend);

const STAGE_COLORS = ["#ef4444", "#f59e0b", "#84cc16", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];
const LINE_COLORS = ["#0d9488", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#84cc16", "#06b6d4"];

/** Largest-Triangle-Three-Buckets downsampling — preserves the visual shape of a line. */
function lttb(
    data: Array<{ x: number; y: number }>,
    threshold: number,
): Array<{ x: number; y: number }> {
    const n = data.length;
    if (threshold >= n || n <= 2) return data;
    const sampled: Array<{ x: number; y: number }> = [data[0]!];
    const bucketSize = (n - 2) / (threshold - 2);
    let a = 0;
    for (let i = 0; i < threshold - 2; i++) {
        const bStart = Math.floor((i + 1) * bucketSize) + 1;
        const bEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n - 1);
        const nStart = Math.floor((i + 2) * bucketSize) + 1;
        const nEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, n - 1);
        let avgX = 0, avgY = 0, count = 0;
        for (let j = nStart; j < nEnd; j++) { avgX += data[j]!.x; avgY += data[j]!.y; count++; }
        if (count > 0) { avgX /= count; avgY /= count; }
        const ax = data[a]!.x, ay = data[a]!.y;
        let maxArea = -1, maxIdx = bStart;
        for (let j = bStart; j < bEnd; j++) {
            const area = Math.abs((ax - avgX) * (data[j]!.y - ay) - (ax - data[j]!.x) * (avgY - ay));
            if (area > maxArea) { maxArea = area; maxIdx = j; }
        }
        sampled.push(data[maxIdx]!);
        a = maxIdx;
    }
    sampled.push(data[n - 1]!);
    return sampled;
}

const borderBoxPlugin: Plugin<"line"> = {
    id: "borderBox",
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

export interface ChartSeries {
    label: string;
    data: Array<number | { x: number; y: number }>;
    color?: string;
}

interface ChartCardProps {
    metricId: number;
    name: string;
    series: ChartSeries[];
    stages?: PerformanceMetricStage[];
    xAxisLabel?: string;
    yAxisLabel?: string;
}

export default function ChartCard({ metricId, name, series, stages, xAxisLabel, yAxisLabel }: ChartCardProps) {
    const chartRef = useRef<ChartJS<"line"> | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const effectiveTitleRef = useRef(name);
    const [isLabelEditorOpen, setIsLabelEditorOpen] = useState(false);
    const [titleOverride, setTitleOverride] = useState(name);
    const [xAxisLabelOverride, setXAxisLabelOverride] = useState(xAxisLabel ?? "Index");
    const [yAxisLabelOverride, setYAxisLabelOverride] = useState(yAxisLabel ?? "Value");
    const [seriesLabelOverrides, setSeriesLabelOverrides] = useState<string[]>(() => series.map((s) => s.label));
    const [isAxisSettingsOpen, setIsAxisSettingsOpen] = useState(false);
    const [xLogScale, setXLogScale] = useState(false);
    const [yLogScale, setYLogScale] = useState(false);

    useEffect(() => {
        setTitleOverride(name);
    }, [name]);

    useEffect(() => {
        setXAxisLabelOverride(xAxisLabel ?? "Index");
    }, [xAxisLabel]);

    useEffect(() => {
        setYAxisLabelOverride(yAxisLabel ?? "Value");
    }, [yAxisLabel]);

    useEffect(() => {
        const newLabels = series.map((s) => s.label);
        // Use functional update so React bails out (returns same reference) when
        // the labels haven't actually changed — prevents a re-render every time the
        // parent passes a new series array identity with identical content.
        setSeriesLabelOverrides((prev) => {
            if (prev.length === newLabels.length && prev.every((l, i) => l === newLabels[i])) return prev;
            return newLabels;
        });
    }, [series]);

    const effectiveTitle = titleOverride.trim() || name;
    const effectiveXAxisLabel = xAxisLabelOverride.trim() || (xAxisLabel ?? "Index");
    const effectiveYAxisLabel = yAxisLabelOverride.trim() || (yAxisLabel ?? "Value");

    const effectiveSeriesLabels = useMemo(
        () => series.map((s, i) => seriesLabelOverrides[i]?.trim() || s.label),
        [series, seriesLabelOverrides],
    );

    useEffect(() => {
        effectiveTitleRef.current = effectiveTitle;
    }, [effectiveTitle]);

    useEffect(() => {
        chartRef.current?.update();
    }, [effectiveTitle, effectiveXAxisLabel, effectiveYAxisLabel]);

    const normalizedSeriesPoints = useMemo(
        () =>
            series.map((s) =>
                s.data.map((item, index) =>
                    typeof item === "number"
                        ? { x: index, y: item }
                        : { x: item.x, y: item.y },
                ),
            ),
        [series],
    );

    const isXYData = useMemo(
        () => series.some((s) => s.data.some((item) => typeof item !== "number")),
        [series],
    );

    const yValues = useMemo(
        () =>
            normalizedSeriesPoints
                .flatMap((pts) => pts.map((pt) => pt.y))
                .filter((value) => Number.isFinite(value)),
        [normalizedSeriesPoints],
    );

    const xValues = useMemo(
        () =>
            normalizedSeriesPoints
                .flatMap((pts) => pts.map((pt) => pt.x))
                .filter((value) => Number.isFinite(value)),
        [normalizedSeriesPoints],
    );

    const xMin = useMemo(() => (xValues.length > 0 ? Math.min(...xValues) : undefined), [xValues]);
    const xMax = useMemo(() => (xValues.length > 0 ? Math.max(...xValues) : undefined), [xValues]);

    const yLogOffset = useMemo(
        () => yLogScale && yValues.length > 0 ? Math.max(0, 1 - Math.min(...yValues)) : 0,
        [yLogScale, yValues],
    );
    const xLogOffset = useMemo(
        () => xLogScale && isXYData && xValues.length > 0 ? Math.max(0, 1 - Math.min(...xValues)) : 0,
        [xLogScale, isXYData, xValues],
    );

    const min = useMemo(() => (yValues.length > 0 ? Math.min(...yValues) : null), [yValues]);
    const max = useMemo(() => (yValues.length > 0 ? Math.max(...yValues) : null), [yValues]);

    const maxSeriesLength = useMemo(
        () => Math.max(0, ...normalizedSeriesPoints.map((pts) => pts.length)),
        [normalizedSeriesPoints],
    );

    const axisNumberFormatter = useMemo(
        () => new Intl.NumberFormat("fr-FR", { useGrouping: true, maximumFractionDigits: 2 }),
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

    const { handleResizePointerDown, isDragging } = useChartResize({ metricId, chartSizes, setChartSize, persistChartSizes, chartRef, containerRef });

    // Decimated index list for category charts — shared between chartData and stageMarkersPlugin
    // so both use the exact same coordinate system.
    const displayIndices = useMemo<number[] | null>(() => {
        if (isXYData) return null;
        const dpr = window.devicePixelRatio || 1;
        const displayThreshold = Math.max(2, Math.round(chartWidth * dpr));
        const stride = Math.max(1, Math.ceil(maxSeriesLength / displayThreshold));
        const indices: number[] = [];
        for (let i = 0; i < maxSeriesLength; i += stride) indices.push(i);
        if (indices.length > 0 && indices[indices.length - 1] !== maxSeriesLength - 1) {
            indices.push(maxSeriesLength - 1);
        }
        return indices;
    }, [isXYData, chartWidth, maxSeriesLength]);

    const normalizedStages = useMemo(
        () => (stages ?? [])
            .map((stage, index) => ({
                label: stage.label,
                sampleIndex: Math.max(0, Math.min(maxSeriesLength - 1, Math.round(stage.sampleIndex))),
                color: STAGE_COLORS[index % STAGE_COLORS.length] ?? "#9ca3af",
            }))
            .sort((a, b) => a.sampleIndex - b.sampleIndex),
        [maxSeriesLength, stages],
    );

    // Keep a ref with all the data the stage-markers plugin needs.
    // Updated synchronously during render so the plugin always reads current values
    // without needing a new plugin object (avoids stale-closure misplacement on resize).
    const stageMarkersDataRef = useRef({
        displayIndices,
        normalizedStages,
        isXYData,
        maxSeriesLength,
        normalizedSeriesPoints,
        xLogOffset,
    });
    stageMarkersDataRef.current = { displayIndices, normalizedStages, isXYData, maxSeriesLength, normalizedSeriesPoints, xLogOffset };

    const titlePlugin = useMemo<Plugin<"line">>(
        () => ({
            id: `centerTitle-${metricId}`,
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

    const stageMarkersPlugin = useMemo<Plugin<"line">>(
        () => ({
            id: `stageMarkers-${metricId}`,
            afterDatasetsDraw(chart) {
                const { displayIndices, normalizedStages, isXYData, maxSeriesLength, normalizedSeriesPoints, xLogOffset } =
                    stageMarkersDataRef.current;

                if (normalizedStages.length === 0 || maxSeriesLength === 0) return;

                const xScale = chart.scales.x as { getPixelForValue: (value: number) => number } | undefined;
                if (!xScale) return;

                const { ctx, chartArea: { left, right, top, bottom } } = chart;

                ctx.save();
                ctx.setLineDash([6, 4]);
                ctx.lineWidth = 2;

                const refSeries = normalizedSeriesPoints[0] ?? [];
                for (const stage of normalizedStages) {
                    let x: number;
                    if (isXYData) {
                        // Linear/log scale: use actual x value from the series
                        const stageXValue = refSeries[stage.sampleIndex]?.x ?? stage.sampleIndex;
                        x = xScale.getPixelForValue(stageXValue + xLogOffset);
                    } else if (displayIndices && displayIndices.length > 0) {
                        // Category scale: getPixelForValue takes a 0-based position in the labels array.
                        // Map stage.sampleIndex (original data index) to a fractional position in displayIndices.
                        const idx = displayIndices.findIndex((di) => di >= stage.sampleIndex);
                        let categoryPos: number;
                        if (idx === -1) {
                            categoryPos = displayIndices.length - 1;
                        } else if (idx === 0 || displayIndices[idx] === stage.sampleIndex) {
                            categoryPos = idx;
                        } else {
                            const prev = displayIndices[idx - 1]!;
                            const curr = displayIndices[idx]!;
                            categoryPos = (idx - 1) + (stage.sampleIndex - prev) / (curr - prev);
                        }
                        x = xScale.getPixelForValue(categoryPos);
                    } else {
                        continue;
                    }
                    if (!Number.isFinite(x) || x < left || x > right) continue;

                    ctx.strokeStyle = stage.color;
                    ctx.beginPath();
                    ctx.moveTo(x, top);
                    ctx.lineTo(x, bottom);
                    ctx.stroke();
                }

                ctx.restore();
            },
        }),
        // Plugin object is stable per metricId; all dynamic data flows through stageMarkersDataRef.
         
        [metricId],
    );

    const handleDownload = useCallback(async () => {
        if (!chartRef.current) return;
        const src = chartRef.current.canvas;
        const dpr = window.devicePixelRatio || 1;

        const LEGEND_PAD_X = 12;
        const LEGEND_PAD_Y = 8;
        const SWATCH_W = 20;
        const SWATCH_GAP = 6;
        const ITEM_GAP = 16;
        const ROW_H = 20;
        const FONT = "bold 12px sans-serif";
        const EXPORT_PAD_X = 20;
        const EXPORT_PAD_Y = 20;
        const LEGEND_TOP_GAP = 8;

        const legendLayout = (() => {
            if (normalizedStages.length === 0) return null;

            const probe = document.createElement("canvas").getContext("2d");
            if (!probe) return null;

            probe.font = FONT;
            const maxRowContentWidth = Math.max(0, src.width / dpr - LEGEND_PAD_X * 2);

            const rows: Array<{
                items: Array<{ stage: (typeof normalizedStages)[number]; itemWidth: number }>;
                rowWidth: number;
            }> = [];

            let currentItems: Array<{ stage: (typeof normalizedStages)[number]; itemWidth: number }> = [];
            let currentRowWidth = 0;

            const flushRow = () => {
                if (currentItems.length === 0) return;
                rows.push({
                    items: currentItems,
                    rowWidth: Math.max(0, currentRowWidth - ITEM_GAP),
                });
                currentItems = [];
                currentRowWidth = 0;
            };

            for (const stage of normalizedStages) {
                const labelWidth = probe.measureText(stage.label).width;
                const itemWidth = SWATCH_W + SWATCH_GAP + labelWidth + ITEM_GAP;

                const projectedRowWidth = currentRowWidth === 0
                    ? itemWidth - ITEM_GAP
                    : currentRowWidth + itemWidth - ITEM_GAP;

                if (currentItems.length > 0 && projectedRowWidth > maxRowContentWidth) {
                    flushRow();
                }

                currentItems.push({ stage, itemWidth });
                currentRowWidth += itemWidth;
            }

            flushRow();
            if (rows.length === 0) return null;

            const contentWidth = Math.max(...rows.map((row) => row.rowWidth));
            const panelWidth = contentWidth + LEGEND_PAD_X * 2;
            const panelHeight = LEGEND_PAD_Y * 2 + rows.length * ROW_H;

            return { rows, contentWidth, panelWidth, panelHeight };
        })();

        const legendH = legendLayout ? LEGEND_TOP_GAP + legendLayout.panelHeight : 0;

        const offscreen = document.createElement("canvas");
        offscreen.width = src.width + Math.round(EXPORT_PAD_X * 2 * dpr);
        offscreen.height = src.height + Math.round((EXPORT_PAD_Y * 2 + legendH) * dpr);
        const ctx2d = offscreen.getContext("2d")!;
        ctx2d.fillStyle = "#ffffff";
        ctx2d.fillRect(0, 0, offscreen.width, offscreen.height);
        ctx2d.drawImage(src, Math.round(EXPORT_PAD_X * dpr), Math.round(EXPORT_PAD_Y * dpr));

        if (legendLayout) {
            ctx2d.save();
            ctx2d.scale(dpr, dpr);

            const chartH = src.height / dpr;
            const panelX = EXPORT_PAD_X + (src.width / dpr - legendLayout.panelWidth) / 2;
            const panelY = EXPORT_PAD_Y + chartH + LEGEND_TOP_GAP;
            const panelW = legendLayout.panelWidth;

            // Panel border
            ctx2d.strokeStyle = "#e5e7eb";
            ctx2d.lineWidth = 1;
            ctx2d.setLineDash([]);
            ctx2d.strokeRect(panelX, panelY, panelW, legendLayout.panelHeight);

            ctx2d.font = FONT;
            ctx2d.fillStyle = "#374151";
            ctx2d.textBaseline = "middle";

            let y = panelY + LEGEND_PAD_Y + ROW_H / 2;

            for (const row of legendLayout.rows) {
                let x = panelX + LEGEND_PAD_X + (legendLayout.contentWidth - row.rowWidth) / 2;

                for (const { stage, itemWidth } of row.items) {
                    // Dashed swatch
                    ctx2d.strokeStyle = stage.color;
                    ctx2d.lineWidth = 2;
                    ctx2d.setLineDash([4, 3]);
                    ctx2d.beginPath();
                    ctx2d.moveTo(x, y);
                    ctx2d.lineTo(x + SWATCH_W, y);
                    ctx2d.stroke();

                    // Label
                    ctx2d.setLineDash([]);
                    ctx2d.lineWidth = 1;
                    ctx2d.fillText(stage.label, x + SWATCH_W + SWATCH_GAP, y);

                    x += itemWidth;
                }

                y += ROW_H;
            }

            ctx2d.restore();
        }

        const blob = await new Promise<Blob>((resolve, reject) =>
            offscreen.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
        );
        let fileHandle: FileSystemFileHandle;
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: `${effectiveTitle}.png`,
                types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
            });
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            console.error("[TimeSeriesMetricCard] showSaveFilePicker failed:", err);
            return;
        }
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
        } catch (err) {
            console.error("[ChartCard] File write failed:", err);
        }
    }, [chartRef, effectiveTitle, normalizedStages]);

    const handleCsvExport = useCallback(async () => {
        const allXValues = Array.from(
            new Set(normalizedSeriesPoints.flatMap((pts) => pts.map((pt) => pt.x))),
        ).sort((a, b) => a - b);

        // Build x-value → marker label map so stages appear in the CSV as a Marker column.
        const refSeries = normalizedSeriesPoints[0] ?? [];
        const markerMap = new Map<number, string>();
        for (const stage of normalizedStages) {
            const stageX = isXYData
                ? (refSeries[stage.sampleIndex]?.x ?? stage.sampleIndex)
                : stage.sampleIndex;
            const existing = markerMap.get(stageX);
            markerMap.set(stageX, existing ? `${existing}; ${stage.label}` : stage.label);
        }
        const hasMarkers = normalizedStages.length > 0;

        const header = [effectiveXAxisLabel, ...effectiveSeriesLabels, ...(hasMarkers ? ["Marker"] : [])].join(",");
        const csvRows = allXValues.map((x) => {
            const yVals = normalizedSeriesPoints.map((pts) => {
                const pt = pts.find((p) => p.x === x);
                return pt !== undefined ? String(pt.y) : "";
            });
            const markerCell = hasMarkers ? [markerMap.get(x) ?? ""] : [];
            return [x, ...yVals, ...markerCell].join(",");
        });
        const csv = [header, ...csvRows].join("\n");
        const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
        let fileHandle: FileSystemFileHandle;
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: `${effectiveTitle}.csv`,
                types: [{ description: "CSV file", accept: { "text/csv": [".csv"] } }],
            });
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            console.error("[TimeSeriesMetricCard] showSaveFilePicker failed:", err);
            return;
        }
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
        } catch (err) {
            console.error("[ChartCard] CSV write failed:", err);
        }
    }, [effectiveTitle, effectiveXAxisLabel, effectiveSeriesLabels, normalizedSeriesPoints, normalizedStages, isXYData]);

    const chartData = useMemo(
        () => {
            const dpr = window.devicePixelRatio || 1;
            const displayThreshold = Math.max(2, Math.round(chartWidth * dpr));

            if (isXYData) {
                const datasets = series.map((s, i) => {
                    const pts = normalizedSeriesPoints[i] ?? [];
                    const color = s.color ?? LINE_COLORS[i % LINE_COLORS.length] ?? "#0d9488";
                    const raw = pts.map((pt) => ({ x: pt.x + xLogOffset, y: pt.y + yLogOffset }));
                    const display = raw.length > displayThreshold ? lttb(raw, displayThreshold) : raw;
                    return {
                        label: effectiveSeriesLabels[i] ?? s.label,
                        data: display,
                        borderColor: color,
                        borderWidth: 1.5,
                        spanGaps: true,
                        pointRadius: display.length <= 20 ? 2 : 0,
                        pointHoverRadius: 4,
                        pointBackgroundColor: color,
                        tension: 0,
                    };
                });
                return { datasets };
            }

            // Category data: use shared displayIndices memo so plugin and chartData stay in sync.
            const indices = displayIndices ?? [];
            const showDots = indices.length <= 20;

            const datasets = series.map((s, i) => {
                const pts = normalizedSeriesPoints[i] ?? [];
                const color = s.color ?? LINE_COLORS[i % LINE_COLORS.length] ?? "#0d9488";
                return {
                    label: effectiveSeriesLabels[i] ?? s.label,
                    data: indices.map((idx) => {
                        const y = pts[idx]?.y;
                        return y !== undefined ? y + yLogOffset : null;
                    }),
                    borderColor: color,
                    borderWidth: 1.5,
                    spanGaps: true,
                    pointRadius: showDots ? 2 : 0,
                    pointHoverRadius: 4,
                    pointBackgroundColor: color,
                    tension: 0,
                };
            });

            return { labels: indices, datasets };
        },
        [series, normalizedSeriesPoints, isXYData, effectiveSeriesLabels, maxSeriesLength, xLogOffset, yLogOffset, displayIndices],
    );

    const options = useMemo<ChartOptions<"line">>(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: { padding: { top: 22 } },
            plugins: {
                legend: {
                    display: series.length > 1,
                    position: "bottom" as const,
                    labels: { color: "#4b5563", font: { size: 12 } },
                },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const item = items[0];
                            if (!item) return `${effectiveXAxisLabel}: `;
                            const xValue = (typeof item.parsed?.x === "number" ? item.parsed.x : Number(item.label)) - xLogOffset;
                            return `${effectiveXAxisLabel}: ${formatAxisTick(xValue)}`;
                        },
                        label: (item) => {
                            const yValue = (typeof item.parsed?.y === "number" ? item.parsed.y : Number(item.raw)) - yLogOffset;
                            const seriesLabel = item.dataset.label ?? effectiveTitle;
                            return `${seriesLabel}: ${formatAxisTick(yValue)}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: isXYData ? (xLogScale ? "logarithmic" : "linear") : "category",
                    ...(isXYData && xMin !== undefined && xMax !== undefined ? { min: xMin + xLogOffset, max: xMax + xLogOffset } : {}),
                    title: { display: true, text: effectiveXAxisLabel, font: { size: 14, weight: "bold" }, color: "#4b5563" },
                    ticks: {
                        font: { size: 14, weight: "bold" },
                        color: "#4b5563",
                        autoSkipPadding: 20,
                        maxRotation: 0,
                        callback: (value) => formatAxisTick(typeof value === "number" ? value - xLogOffset : value),
                    },
                    grid: { color: "#e5e7eb" },
                    border: { color: "#9ca3af" },
                },
                y: {
                    type: yLogScale ? "logarithmic" : "linear",
                    title: { display: true, text: effectiveYAxisLabel, font: { size: 14, weight: "bold" }, color: "#4b5563" },
                    ticks: { font: { size: 14, weight: "bold" }, color: "#4b5563", callback: (value) => formatAxisTick(typeof value === "number" ? value - yLogOffset : value) },
                    grid: { color: "#e5e7eb" },
                    border: { color: "#9ca3af" },
                },
            },
        }),
        [effectiveTitle, effectiveXAxisLabel, effectiveYAxisLabel, formatAxisTick, isXYData, xMin, xMax, series, xLogScale, yLogScale, xLogOffset, yLogOffset],
    );

    return (
        <div className="px-4 py-3 border-b border-gray-200 last:border-b-0">
            <div className="relative mx-auto mb-7" ref={containerRef} style={{ width: chartWidth, height: chartHeight }}>
                <Line
                    ref={chartRef}
                    data={chartData}
                    options={options}
                    plugins={[borderBoxPlugin, titlePlugin, stageMarkersPlugin]}
                />
                <span
                    onClick={() => setIsAxisSettingsOpen((prev) => !prev)}
                    title="Axis settings"
                    className={`material-symbols-outlined absolute right-20 cursor-pointer select-none leading-none z-10 ${isAxisSettingsOpen ? "text-gray-600" : "text-gray-300 hover:text-gray-600"}`}
                    style={{ fontSize: 16, bottom: '-12px' }}
                >
                    tune
                </span>
                <span
                    onClick={handleCsvExport}
                    title="Export CSV"
                    className="material-symbols-outlined absolute right-15 cursor-pointer select-none leading-none z-10 text-gray-300 hover:text-gray-600"
                    style={{ fontSize: 16, bottom: '-12px' }}
                >
                    table_chart
                </span>
                <span
                    onClick={handleDownload}
                    title="Export PNG"
                    className="material-symbols-outlined absolute right-10 cursor-pointer select-none leading-none z-10 text-gray-300 hover:text-gray-600"
                    style={{ fontSize: 16, bottom: '-12px' }}
                >
                    download
                </span>
                <span
                    onClick={() => setIsLabelEditorOpen((prev) => !prev)}
                    title="Edit labels"
                    className={`material-symbols-outlined absolute right-5 cursor-pointer select-none leading-none z-10 ${isLabelEditorOpen ? "text-gray-600" : "text-gray-300 hover:text-gray-600"}`}
                    style={{ fontSize: 16, bottom: '-12px' }}
                >
                    edit_note
                </span>
                <span
                    onPointerDown={handleResizePointerDown}
                    title="Resize"
                    className={`material-symbols-outlined absolute right-0 cursor-se-resize select-none leading-none rotate-270 z-10 ${isDragging ? "text-gray-600" : "text-gray-300 hover:text-gray-600"}`}
                    style={{ fontSize: 16, bottom: '-12px' }}
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
                                placeholder={xAxisLabel ?? "Index"}
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
                    {series.length > 1 && (
                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                            {series.map((s, i) => (
                                <label key={i} className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                    Series {i + 1} label
                                    <input
                                        type="text"
                                        value={seriesLabelOverrides[i] ?? s.label}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setSeriesLabelOverrides((prev) => {
                                                const next = [...prev];
                                                next[i] = value;
                                                return next;
                                            });
                                        }}
                                        className="h-8 rounded border border-gray-300 px-2 text-xs text-gray-800 outline-none focus:border-teal-500"
                                        placeholder={s.label}
                                    />
                                </label>
                            ))}
                        </div>
                    )}
                    <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setTitleOverride(name);
                                setXAxisLabelOverride(xAxisLabel ?? "Index");
                                setYAxisLabelOverride(yAxisLabel ?? "Value");
                                setSeriesLabelOverrides(series.map((s) => s.label));
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
            {isAxisSettingsOpen && (
                <div className="mx-auto mt-2 rounded border border-gray-200 bg-white px-3 py-2" style={{ width: chartWidth }}>
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-700">
                                Y axis — logarithmic
                                {yLogScale && yLogOffset > 0 && (
                                    <span className="ml-2 font-normal text-gray-400">shifted +{formatAxisTick(yLogOffset)}</span>
                                )}
                            </span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={yLogScale}
                                onClick={() => setYLogScale((prev) => !prev)}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${yLogScale ? "bg-teal-600" : "bg-gray-200"}`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${yLogScale ? "translate-x-3" : "translate-x-0"}`}
                                />
                            </button>
                        </div>
                        {isXYData && (
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-gray-700">
                                    X axis — logarithmic
                                    {xLogScale && xLogOffset > 0 && (
                                        <span className="ml-2 font-normal text-gray-400">shifted +{formatAxisTick(xLogOffset)}</span>
                                    )}
                                </span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={xLogScale}
                                    onClick={() => setXLogScale((prev) => !prev)}
                                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${xLogScale ? "bg-teal-600" : "bg-gray-200"}`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${xLogScale ? "translate-x-3" : "translate-x-0"}`}
                                    />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {normalizedStages.length > 0 && (
                <div className="mx-auto mt-2 inline-flex w-fit flex-col items-center rounded border border-gray-200 px-3 py-2">
                    {/* <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Stage legend</div> */}
                    <div className="inline-flex w-fit flex-wrap justify-center gap-x-4 gap-y-1">
                        {normalizedStages.map((stage, index) => (
                            <div key={`${stage.label}-${stage.sampleIndex}-${index}`} className="flex items-center gap-2 text-xs text-gray-700">
                                <span className="inline-block h-0 w-5 border-t-2 border-dashed" style={{ borderTopColor: stage.color }} />
                                <span className="font-medium">{stage.label}</span>
                                {/* <span className="text-gray-500">@ {stage.sampleIndex}</span> */}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div className="flex flex-col gap-2 mt-2">
                <CardModalField id="min" label="Min" value={min !== null ? String(min) : "—"} disabled />
                <CardModalField id="max" label="Max" value={max !== null ? String(max) : "—"} disabled />
            </div>
        </div>
    );
}

