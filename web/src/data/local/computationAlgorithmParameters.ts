import { db } from "./db";
import type { ComputationAlgorithmParameter } from "@/data/local/schemaTypes";

const table = db.table<ComputationAlgorithmParameter, [number, number, number, number]>(
    "computationAlgorithmParameters",
);

export async function getAlgorithmParameters(
    algorithmId: number,
    providerId: number,
    environmentId: number,
): Promise<ComputationAlgorithmParameter[]> {
    return table
        .where("[algorithmId+providerId+environmentId]")
        .equals([algorithmId, providerId, environmentId])
        .toArray();
}

export async function setAlgorithmParameter(
    id: number,
    algorithmId: number,
    providerId: number,
    environmentId: number,
    value: string,
): Promise<void> {
    await table.put({ id, environmentId, providerId, algorithmId, value });
}

export async function getAlgorithmParametersByEnvironment(environmentId: number): Promise<ComputationAlgorithmParameter[]> {
    return table.where("environmentId").equals(environmentId).toArray();
}

export async function saveAlgorithmParameters(values: ComputationAlgorithmParameter[]): Promise<void> {
    await table.bulkPut(values);
}

export async function deleteAlgorithmParametersByEnvironment(environmentId: number): Promise<void> {
    await table.where("environmentId").equals(environmentId).delete();
}
