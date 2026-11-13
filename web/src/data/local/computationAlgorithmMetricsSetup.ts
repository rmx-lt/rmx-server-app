import { db } from "./db";
import type { AlgorithmMetric } from "@/data/local/serviceTypes";

const table = db.table<AlgorithmMetric, [number, number, number]>("algorithmMetricsSetup");

export async function getAllAlgorithmMetrics(): Promise<AlgorithmMetric[]> {
    return table.toArray();
}

export async function bulkPutMetrics(metrics: AlgorithmMetric[]): Promise<void> {
    await table.bulkPut(metrics);
}

export async function deleteAlgorithmMetricsByProvider(computationProviderId: number): Promise<void> {
    await table.where("computationProviderId").equals(computationProviderId).delete();
}
