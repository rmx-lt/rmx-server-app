import {
    fetchMap,
    fetchMaps,
    postMap,
    putMap,
    removeMap,
    isConflict,
    type MapDetail,
    type MapDoc,
    type Zone as ApiZone,
} from "@/data/api/planning";
import { ZONE_CATEGORY, type ZoneCategory } from "@/config/db-ops/enums";
import { MAP_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { computePolygonArea } from "@/utils/geometry";
import type { GeoAnchor, MapInfo, Zone } from "./schemaTypes";

// The user's maps, stored on the server (wiki Server-App, "Planning API").
// The web app uses the server's zone categories ("mowing", "no_go") as they
// are. It can't draw navigation zones yet (rmx-server-app#81), so they are
// kept here and written back unchanged on every save of the same map.

/** Everything the web app holds of one map. */
export interface MapContent {
    /** id 0: not saved yet. */
    map: MapInfo;
    zones: Zone[];
    geoAnchor: GeoAnchor | undefined;
}

/** One entry of the map list. */
export interface MapListItem {
    id: number;
    name: string;
    mowingZoneCount: number;
    noGoZoneCount: number;
    updatedAt: string;
}

/** The revision of each map as last loaded or saved, for the next save. */
const revisions = new Map<number, number>();
/** Zones the web app can't show (navigation zones), per map id. */
const keptZones = new Map<number, ApiZone[]>();

/** Whether the web app draws zones of this category (navigation zones it doesn't yet). */
function isDrawn(category: string): category is ZoneCategory {
    return (Object.values(ZONE_CATEGORY) as string[]).includes(category);
}

function trimName(name: string): string {
    return name.trim().slice(0, MAP_NAME_MAX_LENGTH) || "Untitled";
}

// ---- Wire → app ----------------------------------------------------------------

function fromWire(detail: MapDetail): MapContent {
    const id = detail.id;
    const zones: Zone[] = [];
    const kept: ApiZone[] = [];
    for (const z of detail.doc.zones) {
        if (!isDrawn(z.category)) {
            kept.push(z);
            continue;
        }
        zones.push({
            id: z.id,
            mapId: id,
            category: z.category,
            vertexCount: z.vertices.length,
            area: z.vertices.length >= 3 ? computePolygonArea(z.vertices) : 0,
            vertices: z.vertices.map((v) => ({ x: v.x, y: v.y })),
        });
    }
    keptZones.set(id, kept);
    revisions.set(id, detail.revision);
    const doc = detail.doc;
    return {
        map: {
            id,
            name: detail.name,
            mowingZoneCount: zones.filter((z) => z.category === ZONE_CATEGORY.MOWING).length,
            noGoZoneCount: zones.filter((z) => z.category === ZONE_CATEGORY.NO_GO).length,
        },
        zones,
        geoAnchor: doc.geo_anchor ? { lat: doc.geo_anchor.lat, lon: doc.geo_anchor.lon } : undefined,
    };
}

// ---- App → wire ----------------------------------------------------------------

/**
 * The document of content. keepFrom names the map whose navigation zones are
 * carried along (the map the content was loaded from); their ids move past
 * the drawn zones' when they collide.
 */
function toWire(content: MapContent, keepFrom: number): MapDoc {
    const zones: ApiZone[] = content.zones.map((z) => ({
        id: z.id,
        category: z.category,
        vertices: z.vertices.map((v) => ({ x: v.x, y: v.y })),
    }));
    const used = new Set(zones.map((z) => z.id));
    let next = Math.max(0, ...used) + 1;
    for (const z of keptZones.get(keepFrom) ?? []) {
        const id = used.has(z.id) ? next++ : z.id;
        used.add(id);
        zones.push({ ...z, id });
    }
    return {
        zones,
        geo_anchor: content.geoAnchor ? { lat: content.geoAnchor.lat, lon: content.geoAnchor.lon } : null,
    };
}

function remember(saved: MapDetail): number {
    revisions.set(saved.id, saved.revision);
    // Keep the zones as the server now has them (ids possibly renumbered).
    keptZones.set(saved.id, saved.doc.zones.filter((z) => !isDrawn(z.category)));
    return saved.id;
}

// ---- Operations --------------------------------------------------------------

/** The user's maps, newest change first. */
export async function listMaps(): Promise<MapListItem[]> {
    const maps = await fetchMaps();
    return maps.map((m) => ({
        id: m.id,
        name: m.name,
        mowingZoneCount: m.mowing_zone_count,
        noGoZoneCount: m.no_go_zone_count,
        updatedAt: m.updated_at,
    }));
}

/** Loads a map from the server. */
export async function loadMap(id: number): Promise<MapContent> {
    return fromWire(await fetchMap(id));
}

/**
 * Saves content as the map content.map.id: creates it when the id is 0,
 * otherwise saves over the revision last loaded or saved. Returns the map's
 * id. When the map was saved elsewhere in between (a "conflict"), this
 * document replaces the other one: the user's change is never dropped.
 */
export async function saveMap(content: MapContent): Promise<number> {
    const id = content.map.id;
    if (id === 0) return createMap(content, content.map.name);
    const revision = revisions.get(id);
    if (revision === undefined) throw new Error(`map ${id} was not loaded`);
    try {
        return remember(await putMap(id, { name: trimName(content.map.name), revision, doc: toWire(content, id) }));
    } catch (err) {
        if (!isConflict(err)) throw err;
        return overwriteMap(id, content, content.map.name);
    }
}

/** Saves content as a new map named name. Returns its id. */
export async function createMap(content: MapContent, name: string): Promise<number> {
    const keepFrom = content.map.id;
    const saved = await postMap({ name: trimName(name), doc: toWire(content, keepFrom) });
    return remember(saved);
}

/**
 * Replaces the map id with content, named name, whatever was saved there
 * last (the user chose to overwrite it). Returns id.
 */
export async function overwriteMap(id: number, content: MapContent, name: string): Promise<number> {
    const current = await fetchMap(id);
    const saved = await putMap(id, { name: trimName(name), revision: current.revision, doc: toWire(content, content.map.id) });
    return remember(saved);
}

/** Deletes a map. */
export async function deleteMap(id: number): Promise<void> {
    await removeMap(id);
    revisions.delete(id);
    keptZones.delete(id);
}
