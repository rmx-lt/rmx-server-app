import { create } from "zustand";
import { getUiPreference, setUiPreference } from "@/data/local/uiPreferences";

export const DEFAULT_CHART_WIDTH = 636;
export const DEFAULT_CHART_HEIGHT = 144;
export const MODAL_CHROME_W = 64;
export const MIN_CHART_W = 200;
export const MIN_CHART_H = 130;

const UI_PREF_KEY = "performanceMonitorModal.chartSizes";

export interface ChartSize {
    width: number;
    height: number;
}

interface PerformanceMonitorModalState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    chartSizes: Record<number, ChartSize>;
    setChartSize: (metricId: number, width: number, height: number) => void;
    initChartSizes: () => Promise<void>;
    persistChartSizes: () => Promise<void>;
}

export const usePerformanceMonitorModalStore = create<PerformanceMonitorModalState>()((set, get) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    chartSizes: {},
    setChartSize: (metricId, width, height) =>
        set((state) => ({ chartSizes: { ...state.chartSizes, [metricId]: { width, height } } })),
    initChartSizes: async () => {
        const saved = await getUiPreference<Record<number, ChartSize>>(UI_PREF_KEY, {});
        set({ chartSizes: saved });
    },
    persistChartSizes: async () => {
        await setUiPreference(UI_PREF_KEY, get().chartSizes);
    },
}));
