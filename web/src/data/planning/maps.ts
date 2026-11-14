import {
    fetchMap,
    fetchMaps,
    postMap,
    putMap,
    removeMap,
    type MapDetail,
    type MapDoc,
    type Zone,
    type ZoneCategory,
} from "@/data/api/planning";
import {
    COORD_SYSTEM,
    ENV_FORMAT,
    ENV_TYPE,
    OBJECT_CATEGORY,
    OBJECT_TYPE,
    type CoordSystemType,
    type EnvFormat,
    type EnvType,
    type ObjectCategory,
    type ObjectType,
} from "@/config/db-ops/enums";
import { WORKSPACE_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { computePolygonArea } from "@/utils/geometry";
import type { EnvPoint, Environment, GeoAnchor, Object as CanvasObject } from "./schemaTypes";
import type { LayerSettingParameter } from "./layerTypes";
import { withMissingLayerSettings } from "./layerSettings";

// The user's maps, stored on the server (wiki Server-App, "Planning API").
// The rest of the app still speaks in environments and objects with the
// categories "zone" and "obstacle"; this file translates to the server's
// maps and zones ("mowing", "no_go", "navigation"). The web app can't draw
// navigation zones yet (rmx-server-app#81), so they are kept here and written
// back unchanged on every save of the same map.

/** Everything the web app holds of one map. */
export interface MapContent {
    /** id 0: not saved yet. */
    env: Environment;
    objects: CanvasObject[];
    points: EnvPoint[];
    geoAnchor: GeoAnchor | undefined;
    layerSettings: LayerSettingParameter[];
}

/** One entry of the map list. */
export interface MapListItem {
    id: number;
    name: string;
    zoneCount: number;
    obstacleCount: number;
    updatedAt: string;
}

/** The revision of each map as last loaded or saved, for the next save. */
const revisions = new Map<number, number>();
/** Zones the web app can't show (navigation zones), per map id. */
const keptZones = new Map<number, Zone[]>();

const TO_WIRE: Record<ObjectCategory, ZoneCategory> = {
    [OBJECT_CATEGORY.ZONE]: "mowing",
    [OBJECT_CATEGORY.OBSTACLE]: "no_go",
};
const FROM_WIRE: Partial<Record<ZoneCategory, ObjectCategory>> = {
    mowing: OBJECT_CATEGORY.ZONE,
    no_go: OBJECT_CATEGORY.OBSTACLE,
};

function oneOf<T extends string>(values: Record<string, T>, value: string, fallback: T): T {
    return (Object.values(values) as string[]).includes(value) ? (value as T) : fallback;
}

function trimName(name: string): string {
    return name.trim().slice(0, WORKSPACE_NAME_MAX_LENGTH) || "Untitled";
}

// ---- Wire → app ----------------------------------------------------------------

function fromWire(map: MapDetail): MapContent {
    const id = map.id;
    const objects: CanvasObject[] = [];
    const kept: Zone[] = [];
    for (const z of map.doc.zones) {
        const category = FROM_WIRE[z.category];
        if (!category) {
            kept.push(z);
            continue;
        }
        objects.push({
            id: z.id,
            environmentId: id,
            category,
            type: oneOf<ObjectType>(OBJECT_TYPE, z.type, OBJECT_TYPE.EMPTY),
            vertexCount: z.vertices.length,
            area: z.vertices.length >= 3 ? computePolygonArea(z.vertices) : 0,
            vertices: z.vertices.map((v) => ({ x: v.x, y: v.y })),
        });
    }
    keptZones.set(id, kept);
    revisions.set(id, map.revision);
    const doc = map.doc;
    return {
        env: {
            id,
            name: map.name,
            format: oneOf<EnvFormat>(ENV_FORMAT, doc.format, ENV_FORMAT.POLYGON),
            type: oneOf<EnvType>(ENV_TYPE, doc.type, ENV_TYPE.ANY_OFFLINE),
            coordSystem: oneOf<CoordSystemType>(COORD_SYSTEM, doc.coord_system, COORD_SYSTEM.CARTESIAN),
            headlandEnabled: doc.headland_enabled,
            headlandWidth: doc.headland_width,
            zoneCount: objects.filter((o) => o.category === OBJECT_CATEGORY.ZONE).length,
            obstacleCount: objects.filter((o) => o.category === OBJECT_CATEGORY.OBSTACLE).length,
        },
        objects,
        points: doc.points.map((p) => ({ environmentId: id, type: p.type, point: { x: p.point.x, y: p.point.y } })),
        geoAnchor: doc.geo_anchor ? { lat: doc.geo_anchor.lat, lon: doc.geo_anchor.lon } : undefined,
        layerSettings: withMissingLayerSettings(
            doc.layer_settings.map((s) => ({
                id: s.id,
                layerId: s.layer_id,
                algorithmId: 0,
                providerId: 0,
                environmentId: id,
                value: s.value,
            })),
            id,
        ),
    };
}

// ---- App → wire ----------------------------------------------------------------

/**
 * The document of content. keepFrom names the map whose navigation zones are
 * carried along (the map the content was loaded from); their ids move past
 * the drawn zones' when they collide.
 */
function toWire(content: MapContent, keepFrom: number): MapDoc {
    const zones: Zone[] = content.objects.map((o) => ({
        id: o.id,
        category: TO_WIRE[o.category],
        type: o.type,
        vertices: o.vertices.map((v) => ({ x: v.x, y: v.y })),
    }));
    const used = new Set(zones.map((z) => z.id));
    let next = Math.max(0, ...used) + 1;
    for (const z of keptZones.get(keepFrom) ?? []) {
        const id = used.has(z.id) ? next++ : z.id;
        used.add(id);
        zones.push({ ...z, id });
    }
    const { env } = content;
    return {
        format: env.format,
        type: env.type,
        coord_system: env.coordSystem,
        headland_enabled: env.headlandEnabled,
        headland_width: env.headlandWidth,
        zones,
        points: content.points.map((p) => ({ type: p.type, point: { x: p.point.x, y: p.point.y } })),
        layer_settings: content.layerSettings.map((s) => ({ id: s.id, layer_id: s.layerId, value: s.value })),
        geo_anchor: content.geoAnchor ? { lat: content.geoAnchor.lat, lon: content.geoAnchor.lon } : null,
    };
}

function remember(saved: MapDetail): number {
    revisions.set(saved.id, saved.revision);
    // Keep the zones as the server now has them (ids possibly renumbered).
    keptZones.set(saved.id, saved.doc.zones.filter((z) => !FROM_WIRE[z.category]));
    return saved.id;
}

// ---- Operations --------------------------------------------------------------

/** The user's maps, newest change first. */
export async function listMaps(): Promise<MapListItem[]> {
    const maps = await fetchMaps();
    return maps.map((m) => ({
        id: m.id,
        name: m.name,
        zoneCount: m.mowing_zone_count,
        obstacleCount: m.no_go_zone_count,
        updatedAt: m.updated_at,
    }));
}

/** Loads a map from the server. */
export async function loadMap(id: number): Promise<MapContent> {
    return fromWire(await fetchMap(id));
}

/**
 * Saves content as the map content.env.id: creates it when the id is 0,
 * otherwise saves over the revision last loaded or saved. Returns the map's
 * id. Throws an ApiRequestError with code "conflict" (see isConflict) when
 * the map was saved elsewhere in between.
 */
export async function saveMap(content: MapContent): Promise<number> {
    const id = content.env.id;
    if (id === 0) return createMap(content, content.env.name);
    const revision = revisions.get(id);
    if (revision === undefined) throw new Error(`map ${id} was not loaded`);
    const saved = await putMap(id, { name: trimName(content.env.name), revision, doc: toWire(content, id) });
    return remember(saved);
}

/** Saves content as a new map named name. Returns its id. */
export async function createMap(content: MapContent, name: string): Promise<number> {
    const keepFrom = content.env.id;
    const saved = await postMap({ name: trimName(name), doc: toWire(content, keepFrom) });
    return remember(saved);
}

/**
 * Replaces the map id with content, named name, whatever was saved there
 * last (the user chose to overwrite it). Returns id.
 */
export async function overwriteMap(id: number, content: MapContent, name: string): Promise<number> {
    const current = await fetchMap(id);
    const saved = await putMap(id, { name: trimName(name), revision: current.revision, doc: toWire(content, content.env.id) });
    return remember(saved);
}

/** Deletes a map. */
export async function deleteMap(id: number): Promise<void> {
    await removeMap(id);
    revisions.delete(id);
    keptZones.delete(id);
}
