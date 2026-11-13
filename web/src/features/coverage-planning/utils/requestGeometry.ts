import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import { computeHeadlandDerivedGeometry } from "@/features/coverage-planning/utils/headlandGeometry";
import type { Object as CanvasObject } from "@/data/local/schemaTypes";

export function resolveRequestGeometry(input: {
    objects: CanvasObject[];
    headlandEnabled: boolean;
    headlandWidth: number | null;
}): {
    ok: true;
    zones: Array<{ vertices: Array<{ x: number; y: number }> }>;
    obstacles: Array<{ vertices: Array<{ x: number; y: number }> }>;
} | {
    ok: false;
    error: string;
} {
    const { objects, headlandEnabled, headlandWidth } = input;
    const zoneObjects = objects.filter((o) => o.category === OBJECT_CATEGORY.ZONE);
    const obstacleObjects = objects.filter((o) => o.category === OBJECT_CATEGORY.OBSTACLE);

    if (headlandEnabled && headlandWidth === null) {
        return { ok: false, error: "Headland Width is required when Headland is enabled." };
    }

    const derivedHeadland = computeHeadlandDerivedGeometry({
        objects,
        headlandEnabled,
        headlandWidth,
    });

    if (headlandEnabled && derivedHeadland.shrunkenZones.length === 0) {
        return { ok: false, error: "Headland geometry could not be derived from current zone geometry." };
    }

    const sourceZones = headlandEnabled ? derivedHeadland.shrunkenZones : zoneObjects;
    const sourceObstacles = headlandEnabled ? derivedHeadland.expandedObstacles : obstacleObjects;

    const zones = sourceZones.map((o) => ({
        vertices: o.vertices.map(({ x, y }) => ({ x, y })),
    }));
    const obstacles = sourceObstacles.map((o) => ({
        vertices: o.vertices.map(({ x, y }) => ({ x, y })),
    }));

    return { ok: true, zones, obstacles };
}
