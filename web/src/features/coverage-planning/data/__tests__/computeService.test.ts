import { describe, expect, test } from "bun:test";
import { OBJECT_CATEGORY, OBJECT_TYPE } from "@/config/db-ops/enums";
import { resolveRequestGeometry } from "@/features/coverage-planning/utils/requestGeometry";
import type { Object as CanvasObject } from "@/data/local/schemaTypes";

function makeZone(vertices: Array<{ x: number; y: number }>): CanvasObject {
    return {
        id: 1,
        environmentId: 1,
        category: OBJECT_CATEGORY.ZONE,
        type: OBJECT_TYPE.OFFLINE,
        vertexCount: vertices.length,
        area: 100,
        vertices,
    };
}

function makeObstacle(vertices: Array<{ x: number; y: number }>): CanvasObject {
    return {
        id: 2,
        environmentId: 1,
        category: OBJECT_CATEGORY.OBSTACLE,
        type: OBJECT_TYPE.OFFLINE,
        vertexCount: vertices.length,
        area: 16,
        vertices,
    };
}

describe("resolveRequestGeometry", () => {
    const zone = makeZone([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
    ]);

    const obstacle = makeObstacle([
        { x: 3, y: 3 },
        { x: 5, y: 3 },
        { x: 5, y: 5 },
        { x: 3, y: 5 },
    ]);

    test("uses original geometry when headland is disabled", () => {
        const result = resolveRequestGeometry({
            objects: [zone, obstacle],
            headlandEnabled: false,
            headlandWidth: null,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.zones[0]?.vertices).toEqual(zone.vertices);
        expect(result.obstacles[0]?.vertices).toEqual(obstacle.vertices);
    });

    test("returns error when headland is enabled but width is missing", () => {
        const result = resolveRequestGeometry({
            objects: [zone, obstacle],
            headlandEnabled: true,
            headlandWidth: null,
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain("Headland Width");
    });

    test("uses derived geometry when headland is enabled with valid width", () => {
        const result = resolveRequestGeometry({
            objects: [zone, obstacle],
            headlandEnabled: true,
            headlandWidth: 1,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.zones.length).toBe(1);
        expect(result.obstacles.length).toBe(1);
        expect(result.zones[0]?.vertices).not.toEqual(zone.vertices);
    });
});
