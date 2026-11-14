import type { Table } from "dexie";
import { db } from "./db";
import type { EnvironmentGeoAnchorRecord, GeoAnchor } from "@/data/local/schemaTypes";
import { getSystemGeoAnchor } from "./geoAnchorSystem";

const environmentGeoAnchorTable: Table<EnvironmentGeoAnchorRecord, number> = db.table("environmentGeoAnchor");

export async function getEnvironmentGeoAnchorRecord(environmentId: number): Promise<EnvironmentGeoAnchorRecord | undefined> {
    return environmentGeoAnchorTable.get(environmentId);
}

export async function getEnvironmentGeoAnchor(environmentId: number): Promise<GeoAnchor | undefined> {
    const record = await getEnvironmentGeoAnchorRecord(environmentId);
    return record?.geoAnchor;
}

export async function setEnvironmentGeoAnchor(environmentId: number, geoAnchor: GeoAnchor | null): Promise<void> {
    await environmentGeoAnchorTable.put({
        environmentId,
        geoAnchor: geoAnchor ?? undefined,
    });
}

export async function initEnvironmentGeoAnchorFromSystem(environmentId: number): Promise<void> {
    const existing = await getEnvironmentGeoAnchorRecord(environmentId);
    if (existing) return;
    const systemGeoAnchor = await getSystemGeoAnchor();
    await setEnvironmentGeoAnchor(environmentId, systemGeoAnchor ?? null);
}

export async function deleteEnvironmentGeoAnchor(environmentId: number): Promise<void> {
    await environmentGeoAnchorTable.delete(environmentId);
}