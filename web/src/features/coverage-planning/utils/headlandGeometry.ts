import type { ComputationAlgorithmParameter, Object as CanvasObject } from "@/data/local/schemaTypes";
import type { AlgorithmParameter, CanvasPolygonItem } from "@/data/local/serviceTypes";
import { OBJECT_CATEGORY } from "@/config/db-ops/enums";
import { ensureWinding } from "@/utils/geometry";

const PATH_WIDTH_PARAM_NAME = "Path Width";
const FALLBACK_PATH_WIDTH = 20;
const MITER_LIMIT_MULTIPLIER = 4;

export const SYSTEM_HEADLAND_PROVIDER_PARAM_NAMES = new Set([
    "Headland",
    "Headland Width",
]);

function edgeOffsetNormal(
    begin: { x: number; y: number },
    end: { x: number; y: number },
): { x: number; y: number } {
    const dx = end.x - begin.x;
    const dy = end.y - begin.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-9) return { x: 0, y: 0 };
    return { x: -dy / len, y: dx / len };
}

function offsetPolygonVertices(
    vertices: Array<{ x: number; y: number }>,
    distance: number,
): Array<{ x: number; y: number }> {
    if (vertices.length < 3 || distance <= 0) return vertices;

    const maxMiter = MITER_LIMIT_MULTIPLIER * distance;
    const out: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < vertices.length; i++) {
        const prev = vertices[(i - 1 + vertices.length) % vertices.length]!;
        const curr = vertices[i]!;
        const next = vertices[(i + 1) % vertices.length]!;

        const n1 = edgeOffsetNormal(prev, curr);
        const n2 = edgeOffsetNormal(curr, next);

        const bx = n1.x + n2.x;
        const by = n1.y + n2.y;
        const blen = Math.hypot(bx, by);

        if (blen <= 1e-9) {
            out.push({ x: curr.x + n1.x * distance, y: curr.y + n1.y * distance });
            continue;
        }

        const bHatX = bx / blen;
        const bHatY = by / blen;
        const denom = bHatX * n1.x + bHatY * n1.y;

        if (Math.abs(denom) <= 1e-6) {
            out.push({ x: curr.x + n1.x * distance, y: curr.y + n1.y * distance });
            continue;
        }

        const scale = distance / denom;
        const miterScale = Math.max(-maxMiter, Math.min(maxMiter, scale));

        out.push({
            x: curr.x + bHatX * miterScale,
            y: curr.y + bHatY * miterScale,
        });
    }

    return out;
}

export function resolvePathWidthForSelection(input: {
    algorithmId: number;
    providerId: number;
    environmentId: number;
    catalogParams: AlgorithmParameter[];
    parameterValues: ComputationAlgorithmParameter[];
    fallback?: number;
}): number {
    const { algorithmId, providerId, environmentId, catalogParams, parameterValues, fallback = FALLBACK_PATH_WIDTH } = input;

    const pathWidthParam = catalogParams.find(
        (p) =>
            p.name === PATH_WIDTH_PARAM_NAME
            && p.algorithmId === algorithmId
            && p.computationProviderId === providerId,
    );

    if (!pathWidthParam) return fallback;

    const persisted = parameterValues.find(
        (v) =>
            v.id === pathWidthParam.id
            && v.algorithmId === algorithmId
            && v.providerId === providerId
            && v.environmentId === environmentId,
    );

    const parsed = parseFloat((persisted?.value ?? pathWidthParam.defaultValue ?? "").trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseHeadlandWidth(rawWidth: string): number | null {
    const trimmed = rawWidth.trim();
    if (trimmed === "") return null;
    const parsed = parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, parsed);
}

export function computeHeadlandDerivedGeometry(input: {
    objects: CanvasObject[];
    headlandEnabled: boolean;
    headlandWidth: number | null;
}): {
    shrunkenZones: CanvasPolygonItem[];
    expandedObstacles: CanvasPolygonItem[];
} {
    const { objects, headlandEnabled, headlandWidth } = input;

    if (!headlandEnabled || headlandWidth === null) {
        return {
            shrunkenZones: [],
            expandedObstacles: [],
        };
    }

    const zoneObjects = objects.filter((o) => o.category === OBJECT_CATEGORY.ZONE);
    const obstacleObjects = objects.filter((o) => o.category === OBJECT_CATEGORY.OBSTACLE);

    const shrunkenZones = zoneObjects.map((zone, index) => {
        const offset = offsetPolygonVertices(zone.vertices, headlandWidth);
        return {
            id: index + 1,
            vertices: ensureWinding(offset, OBJECT_CATEGORY.ZONE),
        } satisfies CanvasPolygonItem;
    });

    const expandedObstacles = obstacleObjects.map((obstacle, index) => {
        const offset = offsetPolygonVertices(obstacle.vertices, headlandWidth);
        return {
            id: index + 1,
            vertices: ensureWinding(offset, OBJECT_CATEGORY.OBSTACLE),
        } satisfies CanvasPolygonItem;
    });

    return {
        shrunkenZones,
        expandedObstacles,
    };
}
