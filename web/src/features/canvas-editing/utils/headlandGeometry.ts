import type { Area as Area } from "@/data/planning/schemaTypes";
import type { CanvasPolygonItem } from "@/data/planning/serviceTypes";
import { AREA_CATEGORY } from "@/config/db-ops/enums";
import { ensureWinding } from "@/utils/geometry";

const MITER_LIMIT_MULTIPLIER = 4;

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

export function parseHeadlandWidth(rawWidth: string): number | null {
    const trimmed = rawWidth.trim();
    if (trimmed === "") return null;
    const parsed = parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, parsed);
}

export function computeHeadlandDerivedGeometry(input: {
    objects: Area[];
    headlandEnabled: boolean;
    headlandWidth: number | null;
}): {
    shrunkenAreas: CanvasPolygonItem[];
    expandedNoGoAreas: CanvasPolygonItem[];
} {
    const { objects, headlandEnabled, headlandWidth } = input;

    if (!headlandEnabled || headlandWidth === null) {
        return {
            shrunkenAreas: [],
            expandedNoGoAreas: [],
        };
    }

    const areaObjects = objects.filter((o) => o.category === AREA_CATEGORY.MOWING);
    const noGoAreaObjects = objects.filter((o) => o.category === AREA_CATEGORY.NO_GO);

    const shrunkenAreas = areaObjects.map((area, index) => {
        const offset = offsetPolygonVertices(area.vertices, headlandWidth);
        return {
            id: index + 1,
            vertices: ensureWinding(offset, AREA_CATEGORY.MOWING),
        } satisfies CanvasPolygonItem;
    });

    const expandedNoGoAreas = noGoAreaObjects.map((noGoArea, index) => {
        const offset = offsetPolygonVertices(noGoArea.vertices, headlandWidth);
        return {
            id: index + 1,
            vertices: ensureWinding(offset, AREA_CATEGORY.NO_GO),
        } satisfies CanvasPolygonItem;
    });

    return {
        shrunkenAreas,
        expandedNoGoAreas,
    };
}
