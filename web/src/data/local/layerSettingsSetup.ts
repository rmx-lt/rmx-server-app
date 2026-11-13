import { db } from "./db";
import type { LayerSettingsSetup } from "@/data/local/layerTypes";

export async function getAllLayerSettingsSetup(): Promise<LayerSettingsSetup[]> {
    return db.table<LayerSettingsSetup>("layerSettingsSetup").toArray();
}

export async function replaceLayerSettingsSetupForAlgorithm(
    providerId: number,
    algorithmId: number,
    setups: LayerSettingsSetup[],
): Promise<void> {
    await db.transaction("rw", [
        db.table("layerSettingsSetup"),
        db.table("layerSettings"),
    ], async () => {
        await db
            .table<LayerSettingsSetup>("layerSettingsSetup")
            .where("[algorithmId+providerId]")
            .equals([algorithmId, providerId])
            .delete();
        if (setups.length > 0) {
            await db.table<LayerSettingsSetup>("layerSettingsSetup").bulkPut(setups);
        }

        const validSettingKeys = new Set(
            setups.map((setup) => `${setup.id}:${setup.layerId}:${setup.algorithmId}:${setup.providerId}`),
        );
        await db.table("layerSettings")
            .filter(
                (row) => row.algorithmId === algorithmId
                    && row.providerId === providerId
                    && !validSettingKeys.has(`${row.id}:${row.layerId}:${row.algorithmId}:${row.providerId}`),
            )
            .delete();
    });
}
