import { describe, expect, test } from "bun:test";
import { extractLayerData } from "@/features/canvas-editing/utils/layerDataUtils";
import type { ComputeResult } from "@/data/local/serviceTypes";

describe("extractLayerData", () => {
    test("reads standardized debug.layers entries and coveragePathPlan segments", () => {
        const result = {
            coveragePathPlan: {
                segments: [
                    {
                        id: 1,
                        type: "coverageTransit",
                        path: [],
                    },
                    {
                        id: 2,
                        type: "coverage",
                        path: [],
                    },
                ],
            },
            debug: {
                layers: [
                    {
                        id: 99,
                        source: "fallbackList",
                        list: [{ id: 7 }],
                    },
                ],
            },
        } as ComputeResult;

        expect(extractLayerData(result, "coveragePathPlan")).toHaveLength(2);
        expect(extractLayerData(result, "coveragePathPlan.coverage")).toHaveLength(1);
        expect(extractLayerData(result, "fallbackList")).toEqual([{ id: 7 }]);
        expect(extractLayerData(result, "missingLayer")).toEqual([]);
    });
});