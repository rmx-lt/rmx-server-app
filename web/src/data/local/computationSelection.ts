import type { Table } from "dexie";
import { db } from "./db";
import type { ComputationSelection } from "@/data/local/schemaTypes";

const computationSelectionTable: Table<ComputationSelection, number> = db.table("computationSelection");

function emptyRecord(environmentId: number): ComputationSelection {
    return { environmentId, selectedProviderId: null, selectedAlgorithmId: null };
}

export async function getComputationSelection(environmentId: number): Promise<ComputationSelection> {
    return (await computationSelectionTable.get(environmentId)) ?? emptyRecord(environmentId);
}

export async function saveComputationSelection(computation: ComputationSelection): Promise<void> {
    await computationSelectionTable.put(computation);
}

export async function deleteComputationSelection(environmentId: number): Promise<void> {
    await computationSelectionTable.delete(environmentId);
}
