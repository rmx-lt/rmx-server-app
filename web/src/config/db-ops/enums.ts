// ─── Map Type ───────────────────────────────────────────────────────────────

export const MAP_TYPE = {
    OFFLINE: "offline",
    ONLINE: "online",
    ANY_OFFLINE: "any_offline",
    ANY_ONLINE: "any_online",
} as const;

export type MapType = (typeof MAP_TYPE)[keyof typeof MAP_TYPE];

export const MAP_TYPE_OPTIONS: { value: MapType; label: string }[] = [
    { value: MAP_TYPE.OFFLINE, label: "Off-Line" },
    { value: MAP_TYPE.ONLINE, label: "On-Line" },
    { value: MAP_TYPE.ANY_OFFLINE, label: "Any (default: Off-Line)" },
    { value: MAP_TYPE.ANY_ONLINE, label: "Any (default: On-Line)" },
];

// ─── Map Format ───────────────────────────────────────────────────────────────

export const MAP_FORMAT = {
    POLYGON: "polygon",
    GRID: "grid",
} as const;

export type MapFormat = (typeof MAP_FORMAT)[keyof typeof MAP_FORMAT];

export const MAP_FORMAT_OPTIONS: { value: MapFormat; label: string }[] = [
    { value: MAP_FORMAT.POLYGON, label: "Polygon" },
    // { value: MAP_FORMAT.GRID, label: "Grid" }, // not yet implemented
];

// ─── Coordinate System ────────────────────────────────────────────────────────

export const COORD_SYSTEM = {
    CARTESIAN: "Cartesian",
    GEOGRAPHIC: "Geographic",
} as const;

export type CoordSystemType = (typeof COORD_SYSTEM)[keyof typeof COORD_SYSTEM];

export const COORD_SYSTEM_OPTIONS: { value: CoordSystemType; label: string }[] = [
    { value: COORD_SYSTEM.CARTESIAN, label: "Cartesian" },
    // { value: COORD_SYSTEM.GEOGRAPHIC, label: "Geographic" }, // not yet implemented
];

// ─── Zone Category ────────────────────────────────────────────────────────────

/**
 * The zone categories the web app draws: the server's values (wiki Server-App,
 * "Planning API"). Navigation zones aren't drawn yet (rmx-server-app#81).
 */
export const ZONE_CATEGORY = {
    MOWING: "mowing",
    NO_GO: "no_go",
} as const;

export type ZoneCategory = (typeof ZONE_CATEGORY)[keyof typeof ZONE_CATEGORY];

export const ZONE_CATEGORY_OPTIONS: { value: ZoneCategory; label: string }[] = [
    { value: ZONE_CATEGORY.MOWING, label: "Mowing zone" },
    { value: ZONE_CATEGORY.NO_GO, label: "No-go zone" },
];

// ─── Zone Type ────────────────────────────────────────────────────────────────

export const ZONE_TYPE = {
    EMPTY: "",
    OFFLINE: "offline",
    ONLINE: "online",
} as const;

export type ZoneType = (typeof ZONE_TYPE)[keyof typeof ZONE_TYPE];

export const ZONE_TYPE_OPTIONS: { value: ZoneType; label: string }[] = [
    { value: ZONE_TYPE.EMPTY, label: "" },
    { value: ZONE_TYPE.OFFLINE, label: "Off-Line" },
    { value: ZONE_TYPE.ONLINE, label: "On-Line" },
];

// ─── Map Type Helpers ────────────────────────────────────────────────────────

/**
 * Returns true when the map type is a fixed single type (offline or online),
 * meaning all zones are forced to that type and per-zone selection is disabled.
 */
export function isMapTypeFixed(type: MapType): boolean {
    return type === MAP_TYPE.OFFLINE || type === MAP_TYPE.ONLINE;
}

/**
 * Returns the ZoneType that new (or bulk-updated) zones should receive
 * based on the active map type.
 */
export function defaultZoneTypeForMap(type: MapType): ZoneType {
    return type === MAP_TYPE.ONLINE || type === MAP_TYPE.ANY_ONLINE
        ? ZONE_TYPE.ONLINE
        : ZONE_TYPE.OFFLINE;
}
