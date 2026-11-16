/** Base world-unit size that one grid cell represents at scale 1. */
export const GRID_SPACING = 40;

/**
 * Multiplier steps used to pick a readable grid level at any zoom.
 * The grid snaps to the first step where (GRID_SPACING * step * scale) >= GRID_MIN_CELL_PX.
 */
export const GRID_LEVEL_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] as const;

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
/** 200 shows a 20 cm line 40 px wide when the map unit is metres (the widest case: 0.2 units). */
export const ZOOM_MAX = 200;
/** One wheel step. */
export const ZOOM_FACTOR = 1.15;
/** One click on a zoom button or one zoom shortcut. */
export const ZOOM_BUTTON_FACTOR = 1.5;
/** Time constant of the zoom animation, ms: about 95% of the way after three times this. */
export const ZOOM_ANIMATION_MS = 90;

/** The grid draws a stronger line every this many minor cells. */
export const GRID_MAJOR_EVERY = 5;

/**
 * Layer widths. Users cannot change them; the code sets what is visible. The
 * colours come from the theme (`readCanvasColors` in src/utils/theme.ts).
 * Layers are drawn in this order, grid first.
 */
export const LAYER_STYLE = {
    mowing: { edgeWidth: 1.5 },
    no_go: { edgeWidth: 1.5 },
} as const;
