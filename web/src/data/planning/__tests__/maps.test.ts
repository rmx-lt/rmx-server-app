import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMap, deleteMap, listMaps, loadMap, saveMap, type MapContent } from "@/data/planning/maps";
import { isConflict } from "@/data/api/planning";
import type { MapDetail, MapDoc } from "@/data/api/planning";

// A fake server: records requests and answers from a script.
interface Call {
    method: string;
    url: string;
    body: unknown;
}

let calls: Call[] = [];
let answers: Array<{ status: number; body?: unknown }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
    calls = [];
    answers = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const a = answers.shift() ?? { status: 500 };
        return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status });
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

const DOC: MapDoc = {
    zones: [
        { id: 1, category: "mowing", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        { id: 2, category: "no_go", vertices: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }] },
        { id: 3, category: "navigation", vertices: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 2 }] },
    ],
    geo_anchor: { lat: 54.68, lon: 25.28 },
};

function detail(id: number, revision: number, doc: MapDoc = DOC): MapDetail {
    return { id, name: "Garden", revision, updated_at: "2026-11-14T12:00:00Z", doc };
}

describe("loadMap", () => {
    test("keeps the server's zone categories and keeps navigation zones out of the canvas", async () => {
        answers.push({ status: 200, body: detail(7, 3) });
        const content = await loadMap(7);
        expect(calls[0]).toMatchObject({ method: "GET", url: "/api/maps/7" });
        expect(content.map).toMatchObject({ id: 7, name: "Garden", mowingZoneCount: 1, noGoZoneCount: 1 });
        expect(content.zones.map((z) => [z.id, z.category, z.mapId])).toEqual([
            [1, "mowing", 7],
            [2, "no_go", 7],
        ]);
        expect(content.zones[0]!.vertexCount).toBe(3);
        expect(content.zones[0]!.area).toBeGreaterThan(0);
        expect(content.geoAnchor).toEqual({ lat: 54.68, lon: 25.28 });
    });
});

describe("saveMap", () => {
    async function loaded(): Promise<MapContent> {
        answers.push({ status: 200, body: detail(7, 3) });
        return loadMap(7);
    }

    test("puts the whole document with the loaded revision and writes navigation zones back", async () => {
        const content = await loaded();
        answers.push({ status: 200, body: detail(7, 4) });
        expect(await saveMap({ ...content, map: { ...content.map, name: "  Front  " } })).toBe(7);
        const put = calls[1]!;
        expect(put.method).toBe("PUT");
        expect(put.url).toBe("/api/maps/7");
        const body = put.body as { name: string; revision: number; doc: MapDoc };
        expect(body.name).toBe("Front");
        expect(body.revision).toBe(3);
        expect(body.doc.zones.map((z) => [z.id, z.category])).toEqual([
            [1, "mowing"],
            [2, "no_go"],
            [3, "navigation"],
        ]);
        expect(body.doc.geo_anchor).toEqual({ lat: 54.68, lon: 25.28 });

        // The next save names the new revision.
        answers.push({ status: 200, body: detail(7, 5) });
        await saveMap(content);
        expect((calls[2]!.body as { revision: number }).revision).toBe(4);
    });

    test("moves a navigation zone whose id a new drawn zone took", async () => {
        const content = await loaded();
        const drawn = { ...content.zones[0]!, id: 3 };
        answers.push({ status: 200, body: detail(7, 4) });
        await saveMap({ ...content, zones: [...content.zones, drawn] });
        const ids = (calls[1]!.body as { doc: MapDoc }).doc.zones.map((z) => [z.id, z.category]);
        expect(ids).toEqual([
            [1, "mowing"],
            [2, "no_go"],
            [3, "mowing"],
            [4, "navigation"],
        ]);
    });

    test("creates a map that has no id yet", async () => {
        const content = await loaded();
        answers.push({ status: 201, body: detail(9, 1) });
        const id = await saveMap({ ...content, map: { ...content.map, id: 0, name: "New" } });
        expect(id).toBe(9);
        expect(calls[1]).toMatchObject({ method: "POST", url: "/api/maps" });
    });

    test("a stale revision is a conflict", async () => {
        const content = await loaded();
        answers.push({ status: 409, body: { code: "conflict", message: "changed elsewhere" } });
        const err = await saveMap(content).catch((e: unknown) => e);
        expect(isConflict(err)).toBe(true);
    });
});

describe("copies and the list", () => {
    test("a copy carries the source's navigation zones", async () => {
        answers.push({ status: 200, body: detail(7, 3) });
        const content = await loadMap(7);
        answers.push({ status: 201, body: detail(8, 1) });
        expect(await createMap(content, "Copy")).toBe(8);
        const body = calls[1]!.body as { name: string; doc: MapDoc };
        expect(body.name).toBe("Copy");
        expect(body.doc.zones.some((z) => z.category === "navigation")).toBe(true);
    });

    test("lists maps with zone counts and deletes them", async () => {
        answers.push({
            status: 200,
            body: {
                maps: [{
                    id: 7, name: "Garden", revision: 3, mowing_zone_count: 2, no_go_zone_count: 1,
                    navigation_zone_count: 1, updated_at: "2026-11-14T12:00:00Z",
                }],
            },
        });
        expect(await listMaps()).toEqual([
            { id: 7, name: "Garden", mowingZoneCount: 2, noGoZoneCount: 1, updatedAt: "2026-11-14T12:00:00Z" },
        ]);
        answers.push({ status: 204 });
        await deleteMap(7);
        expect(calls[1]).toMatchObject({ method: "DELETE", url: "/api/maps/7" });
    });
});
