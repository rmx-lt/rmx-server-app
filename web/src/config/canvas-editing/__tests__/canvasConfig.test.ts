import { expect, test } from "bun:test";
import { GRID_MIN_CELL_PX, GRID_SPACING, ZOOM_MAX, pickGridLevel } from "../canvasConfig";

test("the grid cell stays between the minimum and 2.5x it at every zoom", () => {
    for (const scale of [0.001, 0.05, 1, 8, 37, ZOOM_MAX]) {
        const px = GRID_SPACING * pickGridLevel(scale) * scale;
        expect(px).toBeGreaterThanOrEqual(GRID_MIN_CELL_PX);
        expect(px).toBeLessThanOrEqual(GRID_MIN_CELL_PX * 2.5);
    }
});

test("a 20 cm line is at least 30 px wide at full zoom when the unit is metres", () => {
    expect(0.2 * ZOOM_MAX).toBeGreaterThanOrEqual(30);
});
