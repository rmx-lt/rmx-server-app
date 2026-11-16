import {
    fetchMap,
    fetchMaps,
    postMap,
    putMap,
    removeMap,
    isConflict,
    type MapDetail,
    type MapDoc,
    type Area as ApiArea,
} from "@/data/api/planning";
import { AREA_CATEGORY, type AreaCategory } from "@/config/db-ops/enums";
import { MAP_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { computePolygonArea } from "@/utils/geometry";
import type { Area, GeoAnchor, MapInfo, Zone } from "./schemaTypes";

// The user's maps, stored on the server (wiki Server-App, "Planning API").
// The web app uses the server's area categories ("mowing", "no_go") as they
// are. It can't draw navigation areas yet (rmx-server-app#81), and it shows
// one zone at a time, so what it does not show is kept here and written back
// unchanged on every save of the same map.

/** Everything the web app holds of one map. */
export interface MapContent {
    /** id 0: not saved yet. */
    map: MapInfo;
    zones: Zone[];
    /** The zone whose areas are in `areas`. */
    activeZoneId: number;
    /** The drawn areas of the active zone. */
    areas: Area[];
    geoAnchor: GeoAnchor | undefined;
}

/** One entry of the map list. */
export interface MapListItem {
    id: number;
    name: string;
    mowingAreaCount: number;
    noGoAreaCount: number;
    updatedAt: string;
}

/** The revision of each map as last loaded or saved, for the next save. */
const revisions = new Map<number, number>();
/** Areas the web app doesn't show (navigation areas, areas of other zones), per map id. */
const keptAreas = new Map<number, { zoneId: number; area: ApiArea }[]>();

/** A map the server holds that this version of the web app can't read (a format from before zones). */
export class MapFormatError extends Error {
    constructor() {
        super("This map is stored in an old format and can't be opened.");
        this.name = "MapFormatError";
    }
}

/** Whether the web app draws areas of this category (navigation areas it doesn't yet). */
function isDrawn(category: string): category is AreaCategory {
    return (Object.values(AREA_CATEGORY) as string[]).includes(category);
}

/** The areas of doc that stay out of the canvas when `activeZoneId` is shown. */
function keptOf(doc: MapDoc, activeZoneId: number): { zoneId: number; area: ApiArea }[] {
    return doc.zones.flatMap((z) => z.areas.filter((a) => z.id !== activeZoneId || !isDrawn(a.category)).map((area) => ({ zoneId: z.id, area })));
}

function trimName(name: string): string {
    return name.trim().slice(0, MAP_NAME_MAX_LENGTH) || "Untitled";
}

// ---- Wire → app ----------------------------------------------------------------

function fromWire(detail: MapDetail): MapContent {
    const id = detail.id;
    const doc = detail.doc;
    if (doc.zones.length === 0 || doc.zones.some((z) => !Array.isArray(z.areas))) throw new MapFormatError();
    const activeZone = doc.zones[0]!;
    const areas: Area[] = activeZone.areas
        .filter((a) => isDrawn(a.category))
        .map((a) => ({
            id: a.id,
            mapId: id,
            category: a.category as AreaCategory,
            vertexCount: a.vertices.length,
            area: a.vertices.length >= 3 ? computePolygonArea(a.vertices) : 0,
            vertices: a.vertices.map((v) => ({ x: v.x, y: v.y })),
        }));
    keptAreas.set(id, keptOf(doc, activeZone.id));
    revisions.set(id, detail.revision);
    return {
        map: {
            id,
            name: detail.name,
            mowingAreaCount: areas.filter((a) => a.category === AREA_CATEGORY.MOWING).length,
            noGoAreaCount: areas.filter((a) => a.category === AREA_CATEGORY.NO_GO).length,
        },
        zones: doc.zones.map((z) => ({ id: z.id, name: z.name })),
        activeZoneId: activeZone.id,
        areas,
        geoAnchor: doc.geo_anchor ? { lat: doc.geo_anchor.lat, lon: doc.geo_anchor.lon } : undefined,
    };
}

// ---- App → wire ----------------------------------------------------------------

/**
 * The document of content. keepFrom names the map whose kept areas are
 * carried along (the map the content was loaded from); their ids move past
 * the drawn areas' when they collide.
 */
function toWire(content: MapContent, keepFrom: number): MapDoc {
    const drawn: ApiArea[] = content.areas.map((a) => ({
        id: a.id,
        category: a.category,
        vertices: a.vertices.map((v) => ({ x: v.x, y: v.y })),
    }));
    const zones = content.zones.map((z) => ({ id: z.id, name: z.name, areas: z.id === content.activeZoneId ? drawn : [] }));
    const used = new Set(drawn.map((a) => a.id));
    let next = Math.max(0, ...used) + 1;
    for (const { zoneId, area } of keptAreas.get(keepFrom) ?? []) {
        const id = used.has(area.id) ? next++ : area.id;
        used.add(id);
        zones.find((z) => z.id === zoneId)?.areas.push({ ...area, id });
    }
    return {
        zones,
        geo_anchor: content.geoAnchor ? { lat: content.geoAnchor.lat, lon: content.geoAnchor.lon } : null,
    };
}

function remember(saved: MapDetail, activeZoneId: number): number {
    revisions.set(saved.id, saved.revision);
    // Keep the areas as the server now has them (ids possibly renumbered).
    keptAreas.set(saved.id, keptOf(saved.doc, activeZoneId));
    return saved.id;
}

// ---- Operations --------------------------------------------------------------

/** The user's maps, newest change first. */
export async function listMaps(): Promise<MapListItem[]> {
    const maps = await fetchMaps();
    return maps.map((m) => ({
        id: m.id,
        name: m.name,
        mowingAreaCount: m.mowing_area_count,
        noGoAreaCount: m.no_go_area_count,
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
        return remember(await putMap(id, { name: trimName(content.map.name), revision, doc: toWire(content, id) }), content.activeZoneId);
    } catch (err) {
        if (!isConflict(err)) throw err;
        return overwriteMap(id, content, content.map.name);
    }
}

/** Saves content as a new map named name. Returns its id. */
export async function createMap(content: MapContent, name: string): Promise<number> {
    const keepFrom = content.map.id;
    const saved = await postMap({ name: trimName(name), doc: toWire(content, keepFrom) });
    return remember(saved, content.activeZoneId);
}

/**
 * Replaces the map id with content, named name, whatever was saved there
 * last (the user chose to overwrite it). Returns id.
 */
export async function overwriteMap(id: number, content: MapContent, name: string): Promise<number> {
    const current = await fetchMap(id);
    const saved = await putMap(id, { name: trimName(name), revision: current.revision, doc: toWire(content, content.map.id) });
    return remember(saved, content.activeZoneId);
}

/** Renames a map that is not the open one (the open one is renamed in the store and saved with the autosave). */
export async function renameMap(id: number, name: string): Promise<void> {
    const current = await fetchMap(id);
    // The kept areas of this map are worked out again when it is loaded.
    revisions.set(id, (await putMap(id, { name: trimName(name), revision: current.revision, doc: current.doc })).revision);
}

/** Deletes a map. */
export async function deleteMap(id: number): Promise<void> {
    await removeMap(id);
    revisions.delete(id);
    keptAreas.delete(id);
}
