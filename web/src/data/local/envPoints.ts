import type { Table } from "dexie";
import { db } from "./db";
import type { EnvPoint, EnvPointType } from "@/data/local/schemaTypes";

const envPointsTable: Table<EnvPoint, number> = db.table("envPoint");

export async function getEnvPoints(environmentId: number): Promise<EnvPoint[]> {
    return envPointsTable.where("environmentId").equals(environmentId).toArray();
}

export async function upsertEnvPoint(
    environmentId: number,
    type: EnvPointType,
    point: { x: number; y: number },
): Promise<void> {
    const existing = await envPointsTable
        .where("[environmentId+type]")
        .equals([environmentId, type])
        .first();
    if (existing) {
        await envPointsTable.update(existing.id!, { point });
    } else {
        await envPointsTable.add({ environmentId, type, point });
    }
}

export async function deleteEnvPoint(environmentId: number, type: EnvPointType): Promise<void> {
    await envPointsTable.where("[environmentId+type]").equals([environmentId, type]).delete();
}

export async function deleteEnvPointsByEnvironment(environmentId: number): Promise<void> {
    await envPointsTable.where("environmentId").equals(environmentId).delete();
}
