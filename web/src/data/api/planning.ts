import type { ApiError } from "./generated/ApiError";
import type { ErrorCode } from "./generated/ErrorCode";
import type { GeoAnchor as WireGeoAnchor } from "./generated/GeoAnchor";
import type { MapCreate } from "./generated/MapCreate";
import type { MapDetail } from "./generated/MapDetail";
import type { MapDoc } from "./generated/MapDoc";
import type { MapList } from "./generated/MapList";
import type { MapSummary } from "./generated/MapSummary";
import type { MapUpdate } from "./generated/MapUpdate";
import type { Setting } from "./generated/Setting";
import type { SettingList } from "./generated/SettingList";
import type { Zone } from "./generated/Zone";
import type { Area } from "./generated/Area";
import type { AreaCategory } from "./generated/AreaCategory";

// REST client of the planning API (wiki Server-App, "Planning API"): the
// user's maps and settings. Every call needs the session cookie, which the
// browser sends by itself.

export type {
    MapCreate,
    MapDetail,
    MapDoc,
    MapSummary,
    MapUpdate,
    Setting,
    WireGeoAnchor,
    Area,
    AreaCategory,
    Zone,
};

/** A request the server refused, or that never reached it (status 0). */
export class ApiRequestError extends Error {
    constructor(
        readonly status: number,
        readonly code: ErrorCode | "unreachable",
        message: string,
    ) {
        super(message);
        this.name = "ApiRequestError";
    }
}

/** True when a save was refused because someone else saved the map in between (409). */
export function isConflict(err: unknown): boolean {
    return err instanceof ApiRequestError && err.code === "conflict";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`/api${path}`, {
            method,
            headers: body === undefined ? undefined : { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store",
        });
    } catch {
        throw new ApiRequestError(0, "unreachable", "The server can't be reached.");
    }
    if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        throw new ApiRequestError(res.status, err?.code ?? "internal", err?.message ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

/** GET /api/maps: the user's maps, newest change first. */
export async function fetchMaps(): Promise<MapSummary[]> {
    return (await request<MapList>("GET", "/maps")).maps;
}

/** GET /api/maps/{id}. */
export function fetchMap(id: number): Promise<MapDetail> {
    return request<MapDetail>("GET", `/maps/${id}`);
}

/** POST /api/maps: a new map at revision 1. */
export function postMap(body: MapCreate): Promise<MapDetail> {
    return request<MapDetail>("POST", "/maps", body);
}

/** PUT /api/maps/{id}; fails with code "conflict" when body.revision is stale. */
export function putMap(id: number, body: MapUpdate): Promise<MapDetail> {
    return request<MapDetail>("PUT", `/maps/${id}`, body);
}

/** DELETE /api/maps/{id}. */
export function removeMap(id: number): Promise<void> {
    return request<void>("DELETE", `/maps/${id}`);
}

/** GET /api/settings. */
export async function fetchSettings(): Promise<Setting[]> {
    return (await request<SettingList>("GET", "/settings")).settings;
}

/** PUT /api/settings/{key}; value is any JSON value but null. */
export function putSetting(key: string, value: unknown): Promise<void> {
    return request<void>("PUT", `/settings/${encodeURIComponent(key)}`, { value });
}

/** DELETE /api/settings/{key}. */
export function removeSetting(key: string): Promise<void> {
    return request<void>("DELETE", `/settings/${encodeURIComponent(key)}`);
}
