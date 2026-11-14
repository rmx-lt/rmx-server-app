import Dexie from "dexie";
import type { AppEnumValue } from "@/data/local/serviceTypes";
import { LAYER_REGISTRY, LAYER_SETTINGS_SETUP_DEFAULTS } from "@/config/layers/layerRegistry";

const db = new Dexie("blade-terminal");

// Schema versioning policy:
// Browsers hold real data now. Never edit a released version block: add a new
// db.version(n) below it with the changed tables (null drops a table) and, if
// rows must change, an upgrade() function.
db.version(1).stores({
    appEnumSetup: "[enumGroup+value], enumGroup",
    environments: "id, name",
    objects: "[id+environmentId], environmentId",
    computationSelection: "environmentId",
    computationProviders: "++id, name",
    computationProviderAlgorithms: "[id+computationProviderId], computationProviderId",
    computationAlgorithmParametersSetup: "[id+algorithmId+computationProviderId], algorithmId, computationProviderId, [algorithmId+computationProviderId]",
    algorithmMetricsSetup: "[id+algorithmId+computationProviderId], algorithmId, computationProviderId, [algorithmId+computationProviderId]",
    computationAlgorithmParameters: "[id+algorithmId+providerId+environmentId], [algorithmId+providerId+environmentId], environmentId, providerId",
    computeResults: "environmentId",
    coverageGridVisitCache: "environmentId",
    envPoint: "++id, environmentId, type, [environmentId+type]",
    geoAnchorSystem: "id",
    environmentGeoAnchor: "environmentId",
    layers: "[id+algorithmId+providerId], id, algorithmId, providerId, [algorithmId+providerId]",
    layerSettingsSetup: "[id+layerId+algorithmId+providerId], [layerId+algorithmId+providerId], [algorithmId+providerId], providerId",
    layerSettings: "[id+layerId+algorithmId+providerId+environmentId], [layerId+algorithmId+providerId+environmentId], [algorithmId+providerId+environmentId], environmentId, providerId",
    uiPreferences: "key",
});

// Version 2: the client no longer talks to algorithm providers. Drops the
// provider, algorithm, parameter, metric, compute-result and coverage-cache
// tables, and the layers that only showed provider output (the provider
// layers and the coverage grid, layer id 5). Environments, objects, points,
// geo anchors, layer settings of the remaining layers and preferences stay.
const COVERAGE_GRID_LAYER_ID = 5;
db.version(2)
    .stores({
        computationSelection: null,
        computationProviders: null,
        computationProviderAlgorithms: null,
        computationAlgorithmParametersSetup: null,
        algorithmMetricsSetup: null,
        computationAlgorithmParameters: null,
        computeResults: null,
        coverageGridVisitCache: null,
    })
    .upgrade(async (tx) => {
        // Layers of providers have algorithmId/providerId other than 0.
        const isRemovedLayer = (row: { layerId?: number; id?: number; algorithmId: number; providerId: number }, layerId: number | undefined) =>
            row.algorithmId !== 0 || row.providerId !== 0 || layerId === COVERAGE_GRID_LAYER_ID;
        await tx.table("layers").filter((r) => isRemovedLayer(r, r.id)).delete();
        await tx.table("layerSettingsSetup").filter((r) => isRemovedLayer(r, r.layerId)).delete();
        await tx.table("layerSettings").filter((r) => isRemovedLayer(r, r.layerId)).delete();
    });

db.on("populate", () => {
    // seed appEnumSetup and layers/layerSettings for fresh databases
    return seedInitialData();
});

async function seedInitialData(): Promise<void> {
    await seedAppEnums();
    await seedLayers();
}

async function seedAppEnums(): Promise<void> {
    const rows: AppEnumValue[] = [
        { enumGroup: "format", value: "polygon", label: "Polygon" },
        { enumGroup: "format", value: "grid", label: "Grid" },
        { enumGroup: "type", value: "offline", label: "Off-Line" },
        { enumGroup: "type", value: "online", label: "On-Line" },
        { enumGroup: "coordsystem", value: "decimal", label: "Cartesian" },
        { enumGroup: "coordsystem", value: "latlong", label: "Geographic" },
    ];
    await db.table("appEnumSetup").bulkPut(rows);
}

export { db };

async function seedLayers(): Promise<void> {
    for (const def of LAYER_REGISTRY) {
        await db.table("layers").add({
            id: def.id,
            algorithmId: 0,
            providerId: 0,
            label: def.name,
            type: def.type,
        });
    }
    await db.table("layerSettingsSetup").bulkPut(LAYER_SETTINGS_SETUP_DEFAULTS);
}
