import { describe, expect, test } from "bun:test";
import { isLayerVisible, MODES } from "../modes";

describe("mode layers", () => {
    test("every mode shows the zones", () => {
        for (const { id } of MODES) expect(isLayerVisible(id, "zones")).toBe(true);
    });
    test("drive shows the draft border, mow shows the job path and progress, plan neither", () => {
        expect(isLayerVisible("drive", "draftBorder")).toBe(true);
        expect(isLayerVisible("mow", "jobPath")).toBe(true);
        expect(isLayerVisible("mow", "progress")).toBe(true);
        expect(isLayerVisible("plan", "mower")).toBe(false);
        expect(isLayerVisible("mow", "draftBorder")).toBe(false);
    });
});
