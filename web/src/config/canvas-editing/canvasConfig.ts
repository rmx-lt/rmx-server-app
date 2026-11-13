/** Base world-unit size that one grid cell represents at scale 1. */
export const GRID_SPACING = 40;

/**
 * Multiplier steps used to pick a readable grid level at any zoom.
 * The grid snaps to the first step where (GRID_SPACING * step * scale) >= GRID_MIN_CELL_PX.
 */
export const GRID_LEVEL_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] as const;

/** Minimum grid cell size in pixels before stepping up to the next level. */
export const GRID_MIN_CELL_PX = 40;

/**
 * Picks the smallest grid level multiplier such that the resulting cell size
 * in pixels is at least GRID_MIN_CELL_PX. Shared by the grid layer and scale bar.
 */
export function pickGridLevel(scale: number): number {
    for (const step of GRID_LEVEL_STEPS) {
        if (GRID_SPACING * step * scale >= GRID_MIN_CELL_PX) return step;
    }
    return GRID_LEVEL_STEPS[GRID_LEVEL_STEPS.length - 1] ?? 1000;
}

export const ZOOM_MIN = 0.000001;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 0.1;
export const ZOOM_FACTOR = 1.15;

export const COLOR_VERTEX_FILL = "#ffffff";
export const COLOR_VERTEX_SELECTED_STROKE = "#2b7fff";

export const COLOR_EDGE_MIDPOINT_FILL = "rgba(255,255,255,0.8)";
export const COLOR_EDGE_MIDPOINT_STROKE = "#94a3b8";
