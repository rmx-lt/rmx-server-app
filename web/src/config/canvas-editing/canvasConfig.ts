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

/**
 * Layer widths. Users cannot change them; the code sets what is visible. The
 * colours come from the theme (`readCanvasColors` in src/utils/theme.ts).
 * Layers are drawn in this order, grid first.
 */
export const LAYER_STYLE = {
    mowing: { edgeWidth: 1.5 },
    no_go: { edgeWidth: 1.5 },
} as const;
