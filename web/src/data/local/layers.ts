import { db } from "./db";
import type { LayerRecord } from "@/data/local/layerTypes";

export async function getAllLayers(): Promise<LayerRecord[]> {
    return db.table<LayerRecord>("layers").toArray();
}

export async function getLayerById(id: number): Promise<LayerRecord | undefined> {
    return db.table<LayerRecord>("layers").where("id").equals(id).first();
}

export async function replaceLayersForAlgorithm(
    providerId: number,
    algorithmId: number,
    layers: LayerRecord[],
): Promise<void> {
    await db.transaction("rw", [
        db.table("layers"),
        db.table("layerSettingsSetup"),
        db.table("layerSettings"),
    ], async () => {
        await db
            .table<LayerRecord>("layers")
            .where("[algorithmId+providerId]")
            .equals([algorithmId, providerId])
            .delete();
        if (layers.length > 0) {
            await db.table<LayerRecord>("layers").bulkPut(layers);
        }

        const validLayerKeys = new Set(layers.map((layer) => layer.id));
        await db.table("layerSettingsSetup")
            .filter(
                (row) => row.algorithmId === algorithmId
                    && row.providerId === providerId
                    && !validLayerKeys.has(row.layerId),
            )
            .delete();
        await db.table("layerSettings")
            .filter(
                (row) => row.algorithmId === algorithmId
                    && row.providerId === providerId
                    && !validLayerKeys.has(row.layerId),
            )
            .delete();
    });
}
