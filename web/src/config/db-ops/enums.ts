// ─── Environment Type ───────────────────────────────────────────────────────

export const ENV_TYPE = {
    OFFLINE: "offline",
    ONLINE: "online",
    ANY_OFFLINE: "any_offline",
    ANY_ONLINE: "any_online",
} as const;

export type EnvType = (typeof ENV_TYPE)[keyof typeof ENV_TYPE];

export const ENV_TYPE_OPTIONS: { value: EnvType; label: string }[] = [
    { value: ENV_TYPE.OFFLINE, label: "Off-Line" },
    { value: ENV_TYPE.ONLINE, label: "On-Line" },
    { value: ENV_TYPE.ANY_OFFLINE, label: "Any (default: Off-Line)" },
    { value: ENV_TYPE.ANY_ONLINE, label: "Any (default: On-Line)" },
];

// ─── Environment Format ────────────────────────────────────────────────────────

export const ENV_FORMAT = {
    POLYGON: "polygon",
    GRID: "grid",
} as const;

export type EnvFormat = (typeof ENV_FORMAT)[keyof typeof ENV_FORMAT];

export const ENV_FORMAT_OPTIONS: { value: EnvFormat; label: string }[] = [
    { value: ENV_FORMAT.POLYGON, label: "Polygon" },
    // { value: ENV_FORMAT.GRID, label: "Grid" }, // not yet implemented
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

// ─── Object Category ──────────────────────────────────────────────────────────

export const OBJECT_CATEGORY = {
    ZONE: "zone",
    OBSTACLE: "obstacle",
} as const;

export type ObjectCategory = (typeof OBJECT_CATEGORY)[keyof typeof OBJECT_CATEGORY];

export const OBJECT_CATEGORY_OPTIONS: { value: ObjectCategory; label: string }[] = [
    { value: OBJECT_CATEGORY.ZONE, label: "Zone" },
    { value: OBJECT_CATEGORY.OBSTACLE, label: "Obstacle" },
];

// ─── Object Type ──────────────────────────────────────────────────────────────

export const OBJECT_TYPE = {
    EMPTY: "",
    OFFLINE: "offline",
    ONLINE: "online",
} as const;

export type ObjectType = (typeof OBJECT_TYPE)[keyof typeof OBJECT_TYPE];

export const OBJECT_TYPE_OPTIONS: { value: ObjectType; label: string }[] = [
    { value: OBJECT_TYPE.EMPTY, label: "" },
    { value: OBJECT_TYPE.OFFLINE, label: "Off-Line" },
    { value: OBJECT_TYPE.ONLINE, label: "On-Line" },
];

// ─── Environment Type Helpers ────────────────────────────────────────────────

/**
 * Returns true when the env type is a fixed single type (offline or online),
 * meaning all objects are forced to that type and per-object selection is disabled.
 */
export function isEnvTypeFixed(type: EnvType): boolean {
    return type === ENV_TYPE.OFFLINE || type === ENV_TYPE.ONLINE;
}

/**
 * Returns the ObjectType that new (or bulk-updated) objects should receive
 * based on the active environment type.
 */
export function defaultObjectTypeForEnv(type: EnvType): ObjectType {
    return type === ENV_TYPE.ONLINE || type === ENV_TYPE.ANY_ONLINE
        ? OBJECT_TYPE.ONLINE
        : OBJECT_TYPE.OFFLINE;
}
