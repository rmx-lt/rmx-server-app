import { db } from "./db";
import type { LayerRecord } from "@/data/local/layerTypes";

export async function getAllLayers(): Promise<LayerRecord[]> {
    return db.table<LayerRecord>("layers").toArray();
}

export async function getLayerById(id: number): Promise<LayerRecord | undefined> {
    return db.table<LayerRecord>("layers").where("id").equals(id).first();
}
