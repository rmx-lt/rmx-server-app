import type { Table } from "dexie";
import { db } from "./db";
import type { GeoAnchor, GeoAnchorSystemRecord } from "@/data/local/schemaTypes";

export const SYSTEM_GEO_ANCHOR_ID = 1;

const geoAnchorSystemTable: Table<GeoAnchorSystemRecord, number> = db.table("geoAnchorSystem");

export async function getSystemGeoAnchorRecord(): Promise<GeoAnchorSystemRecord | undefined> {
    return geoAnchorSystemTable.get(SYSTEM_GEO_ANCHOR_ID);
}

export async function getSystemGeoAnchor(): Promise<GeoAnchor | undefined> {
    const record = await getSystemGeoAnchorRecord();
    return record?.geoAnchor;
}

export async function setSystemGeoAnchor(geoAnchor: GeoAnchor | null): Promise<void> {
    await geoAnchorSystemTable.put({
        id: SYSTEM_GEO_ANCHOR_ID,
        geoAnchor: geoAnchor ?? undefined,
    });
}