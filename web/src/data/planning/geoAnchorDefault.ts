import type { GeoAnchor } from "./schemaTypes";
import { getSetting, setSetting } from "./settings";

// The user's default geo anchor: where new maps are placed on the earth.
// Stored as the per-user setting "geoAnchor.default".

const KEY = "geoAnchor.default";

function isGeoAnchor(v: unknown): v is GeoAnchor {
    const a = v as GeoAnchor | null;
    return typeof a?.lat === "number" && typeof a.lon === "number";
}

export async function getDefaultGeoAnchor(): Promise<GeoAnchor | undefined> {
    const value = await getSetting<unknown>(KEY, undefined);
    return isGeoAnchor(value) ? { lat: value.lat, lon: value.lon } : undefined;
}

export async function setDefaultGeoAnchor(geoAnchor: GeoAnchor | null): Promise<void> {
    await setSetting(KEY, geoAnchor ? { lat: geoAnchor.lat, lon: geoAnchor.lon } : null);
}
