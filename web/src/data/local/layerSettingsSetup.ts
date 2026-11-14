import { db } from "./db";
import type { LayerSettingsSetup } from "@/data/local/layerTypes";

export async function getAllLayerSettingsSetup(): Promise<LayerSettingsSetup[]> {
    return db.table<LayerSettingsSetup>("layerSettingsSetup").toArray();
}
