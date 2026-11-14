import { describe, expect, test } from "bun:test";
import { buildExportXml } from "@/features/map-manager/utils/exportMapXml";
import { isImportError, parseZoneCategory } from "@/features/map-manager/utils/importMapXml";
import type { MapInfo, Zone } from "@/data/planning/schemaTypes";

const MAP: MapInfo = {
    id: 7,
    name: "Garden",
    format: "polygon",
    type: "any_offline",
    coordSystem: "Cartesian",
    headlandEnabled: true,
    headlandWidth: "10",
    mowingZoneCount: 1,
    noGoZoneCount: 1,
};

function zone(id: number, category: Zone["category"]): Zone {
    return { id, mapId: 7, category, type: "", vertexCount: 3, area: 0, vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] };
}

describe("buildExportXml", () => {
    test("writes the server's zone categories", () => {
        const xml = buildExportXml(MAP, [zone(1, "mowing"), zone(2, "no_go")]);
        expect(xml).toContain("<category>mowing</category>");
        expect(xml).toContain("<category>no_go</category>");
    });

    test("names the elements map, info, zones, zone and points", () => {
        const xml = buildExportXml(MAP, [zone(1, "mowing")], [{ mapId: 7, type: "start_end", point: { x: 1, y: 2 } }]);
        const tags = new Set([...xml.matchAll(/<([a-zA-Z]+)>/g)].map((m) => m[1]));
        for (const tag of ["map", "info", "zones", "zone", "points", "point"]) expect(tags.has(tag)).toBe(true);
        for (const old of ["workspace", "environment", "objects", "object", "envPoints"]) expect(tags.has(old)).toBe(false);
    });
});

describe("parseZoneCategory", () => {
    test("reads the server's zone categories", () => {
        expect(parseZoneCategory("mowing", "<zone> #1")).toBe("mowing");
        expect(parseZoneCategory("no_go", "<zone> #1")).toBe("no_go");
    });

    test("refuses any other category, including the old zone and obstacle, naming the allowed values", () => {
        for (const old of ["zone", "obstacle", "navigation"]) {
            const result = parseZoneCategory(old, "<zone> #2");
            expect(typeof result !== "string" && isImportError(result)).toBe(true);
            expect(result).toEqual({ error: `Invalid <category> "${old}" in <zone> #2. Expected one of: mowing, no_go.` });
        }
    });
});
