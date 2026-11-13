import type { Table } from "dexie";
import { db } from "./db";
import type { ComputeResultRecord } from "@/data/local/schemaTypes";

const table: Table<ComputeResultRecord, number> = db.table("computeResults");

export async function getComputeResult(environmentId: number): Promise<ComputeResultRecord | undefined> {
    return table.get(environmentId);
}

export async function saveComputeResult(record: ComputeResultRecord): Promise<void> {
    await table.put(record);
}

export async function deleteComputeResult(environmentId: number): Promise<void> {
    await table.delete(environmentId);
}
