import { create } from "zustand";
import type { ComputeResultRecord, CoverageGridVisitEntry } from "@/data/local/schemaTypes";

export type ComputeStatus = "idle" | "submitting" | "polling" | "completed" | "failed";
export type CoverageMetricsSource = "none" | "cache" | "computed";

export interface CoverageMetricsState {
    resultSignature: string | null;
    cellSize: number | null;
    pathWidth: number | null;
    coverageRatioPct: number | null;
    overlapRatioPct: number | null;
    turnCount: number | null;
    pathLength: number | null;
    efficiency: number | null;
    visitEntries: CoverageGridVisitEntry[];
    maxCount: number;
    source: CoverageMetricsSource;
    computedAt: string | null;
}

const EMPTY_COVERAGE_METRICS: CoverageMetricsState = {
    resultSignature: null,
    cellSize: null,
    pathWidth: null,
    coverageRatioPct: null,
    overlapRatioPct: null,
    turnCount: null,
    pathLength: null,
    efficiency: null,
    visitEntries: [],
    maxCount: 0,
    source: "none",
    computedAt: null,
};

interface ComputeResultState {
    result: ComputeResultRecord | null;
    status: ComputeStatus;
    /** True while the execution status modal is visible. */
    isModalOpen: boolean;
    /** Timestamp (ms) when the modal was opened — used to enforce the 500 ms minimum display time. */
    openedAt: number | null;
    /** Error message set when status transitions to "failed". */
    error: string | null;
    /** True when the result has changed since the last DB sync (new result or cleared). */
    isComputeResultDirty: boolean;
    /** Cached coverage-grid visits + derived inspector metrics for current result signature/cell size. */
    coverageMetrics: CoverageMetricsState;
    /** Stages a new compute result and marks dirty. Used after a successful compute run. */
    setResult: (record: ComputeResultRecord) => void;
    /** Hydrates the result from DB on environment load. Does NOT mark dirty. */
    loadResult: (record: ComputeResultRecord) => void;
    setCoverageMetrics: (metrics: CoverageMetricsState) => void;
    clearCoverageMetrics: () => void;
    /** Sets status. Calling with "submitting" opens the modal and captures the open timestamp. */
    setStatus: (status: ComputeStatus) => void;
    setError: (error: string) => void;
    /** Closes the modal and resets transient execution state. Preserves the last result. */
    closeModal: () => void;
    /** Clears the staged result and marks dirty so the next save will sync (delete) the DB record. */
    clearResult: () => void;
    /** Resets the store to initial state without marking dirty. Used on environment load when no result exists. */
    resetResult: () => void;
    /** Clears the dirty flag after the result has been synced to DB by saveCanvas. */
    clearDirty: () => void;
}

export const useComputeResultStore = create<ComputeResultState>((set) => ({
    result: null,
    status: "idle",
    isModalOpen: false,
    openedAt: null,
    error: null,
    isComputeResultDirty: false,
    coverageMetrics: EMPTY_COVERAGE_METRICS,

    setResult: (record) =>
        set({ result: record, status: "completed", isComputeResultDirty: true, coverageMetrics: EMPTY_COVERAGE_METRICS }),

    loadResult: (record) =>
        set({ result: record, status: "completed", isComputeResultDirty: false, coverageMetrics: EMPTY_COVERAGE_METRICS }),

    setCoverageMetrics: (coverageMetrics) => set({ coverageMetrics }),

    clearCoverageMetrics: () => set({ coverageMetrics: EMPTY_COVERAGE_METRICS }),

    setStatus: (status) => {
        if (status === "submitting") {
            set({ status, isModalOpen: true, openedAt: Date.now(), error: null });
        } else {
            set({ status });
        }
    },

    setError: (error) => set({ error }),

    closeModal: () => set({ isModalOpen: false, status: "idle", error: null }),

    clearResult: () =>
        set({
            result: null,
            status: "idle",
            isModalOpen: false,
            openedAt: null,
            error: null,
            isComputeResultDirty: true,
            coverageMetrics: EMPTY_COVERAGE_METRICS,
        }),

    resetResult: () =>
        set({
            result: null,
            status: "idle",
            isModalOpen: false,
            openedAt: null,
            error: null,
            isComputeResultDirty: false,
            coverageMetrics: EMPTY_COVERAGE_METRICS,
        }),

    clearDirty: () => set({ isComputeResultDirty: false }),
}));
