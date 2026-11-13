import { db } from "./db";
import type { ComputationAlgorithm } from "@/data/local/serviceTypes";

export async function getAlgorithmsByProvider(computationProviderId: number): Promise<ComputationAlgorithm[]> {
    return db.table("computationProviderAlgorithms").where("computationProviderId").equals(computationProviderId).toArray();
}

export async function getAllComputationAlgorithms(): Promise<ComputationAlgorithm[]> {
    return db.table("computationProviderAlgorithms").toArray();
}

export async function updateAlgorithmName(id: number, computationProviderId: number, name: string): Promise<void> {
    await db.table("computationProviderAlgorithms").update([id, computationProviderId], { name });
}

export async function deleteAlgorithmWithParameters(id: number, computationProviderId: number): Promise<void> {
    await db.transaction("rw", [
        db.table("computationProviderAlgorithms"),
        db.table("computationAlgorithmParametersSetup"),
        db.table("algorithmMetricsSetup"),
        db.table("computationAlgorithmParameters"),
        db.table("computationSelection"),
        db.table("layers"),
        db.table("layerSettingsSetup"),
        db.table("layerSettings"),
    ], async () => {
        await db.table("computationAlgorithmParametersSetup")
            .where("[algorithmId+computationProviderId]")
            .equals([id, computationProviderId])
            .delete();
        await db.table("algorithmMetricsSetup")
            .where("[algorithmId+computationProviderId]")
            .equals([id, computationProviderId])
            .delete();
        await db.table("computationAlgorithmParameters")
            .filter((row) => row.algorithmId === id && row.providerId === computationProviderId)
            .delete();
        await db.table("computationSelection")
            .filter((row) => row.selectedProviderId === computationProviderId && row.selectedAlgorithmId === id)
            .modify({ selectedAlgorithmId: null });
        await db.table("layers")
            .where("[algorithmId+providerId]")
            .equals([id, computationProviderId])
            .delete();
        await db.table("layerSettingsSetup")
            .where("[algorithmId+providerId]")
            .equals([id, computationProviderId])
            .delete();
        await db.table("layerSettings")
            .filter((row) => row.algorithmId === id && row.providerId === computationProviderId)
            .delete();
        await db.table("computationProviderAlgorithms")
            .where("[id+computationProviderId]")
            .equals([id, computationProviderId])
            .delete();
    });
}

export async function replaceAlgorithmsForProvider(
    computationProviderId: number,
    algorithms: Omit<ComputationAlgorithm, "id">[],
): Promise<ComputationAlgorithm[]> {
    return db.transaction("rw", [
        db.table("computationProviderAlgorithms"),
        db.table("computationAlgorithmParametersSetup"),
        db.table("algorithmMetricsSetup"),
        db.table("computationAlgorithmParameters"),
        db.table("computationSelection"),
        db.table("layers"),
        db.table("layerSettingsSetup"),
        db.table("layerSettings"),
    ], async () => {
        await db.table("computationAlgorithmParametersSetup").where("computationProviderId").equals(computationProviderId).delete();
        await db.table("algorithmMetricsSetup").where("computationProviderId").equals(computationProviderId).delete();
        await db.table("computationAlgorithmParameters").filter((row) => row.providerId === computationProviderId).delete();
        await db.table("computationSelection")
            .filter((row) => row.selectedProviderId === computationProviderId)
            .modify({ selectedAlgorithmId: null });
        await db.table("layers").where("providerId").equals(computationProviderId).delete();
        await db.table("layerSettingsSetup").filter((row) => row.providerId === computationProviderId).delete();
        await db.table("layerSettings").filter((row) => row.providerId === computationProviderId).delete();
        await db.table("computationProviderAlgorithms").where("computationProviderId").equals(computationProviderId).delete();

        const saved: ComputationAlgorithm[] = [];
        for (let i = 0; i < algorithms.length; i++) {
            const record: ComputationAlgorithm = { ...algorithms[i]!, id: i + 1, computationProviderId };
            await db.table("computationProviderAlgorithms").put(record);
            saved.push(record);
        }
        return saved;
    });
}
