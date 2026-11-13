import type { Table } from "dexie";
import { db } from "./db";
import type { CoverageGridVisitCacheRecord } from "@/data/local/schemaTypes";

const table: Table<CoverageGridVisitCacheRecord, number> = db.table("coverageGridVisitCache");

export async function getCoverageGridVisitCache(
    environmentId: number,
): Promise<CoverageGridVisitCacheRecord | undefined> {
    return table.get(environmentId);
}

export async function saveCoverageGridVisitCache(record: CoverageGridVisitCacheRecord): Promise<void> {
    await table.put(record);
}

export async function deleteCoverageGridVisitCacheByEnvironment(environmentId: number): Promise<void> {
    await table.delete(environmentId);
}
