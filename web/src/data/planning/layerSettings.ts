import type { LayerRecord, LayerSettingParameter, LayerSettingView, LayerSettingsSetup } from "./layerTypes";
import { LAYER_REGISTRY, LAYER_SETTINGS_SETUP_DEFAULTS } from "./layerRegistry";

// The canvas layers and their settings. The layers and the setup of their
// settings (key, type, default) are constants in layerRegistry.ts; only each
// map's values are stored, in the map document.

/** The canvas layers, from the layer registry. */
export function getAllLayers(): LayerRecord[] {
    return LAYER_REGISTRY.map((def) => ({ id: def.id, algorithmId: 0, providerId: 0, label: def.name, type: def.type }));
}

/** The setup of every layer setting. */
export function getAllLayerSettingsSetup(): LayerSettingsSetup[] {
    return LAYER_SETTINGS_SETUP_DEFAULTS;
}

/**
 * Builds the initial string value for a layer setting from its setup record.
 * For `PointLabelEnum` rows the colour mapping is encoded as JSON so that the
 * inspector panel can display the correct per-value colours immediately. All
 * other rows fall back to the plain `defaultValue` string.
 */
function buildInitialValue(setup: LayerSettingsSetup): string {
    if (setup.styleType === "PointLabelEnum" && Array.isArray(setup.enumValues) && setup.enumValues.length > 0) {
        const entries = setup.enumValues.map((v) => ({
            value: v,
            color: setup.mapping?.find((m) => m.value === v)?.color ?? null,
        }));
        return JSON.stringify(entries);
    }
    return setup.defaultValue ?? "";
}

function settingKey(s: { id: number; layerId: number }): string {
    return `${s.id}:${s.layerId}`;
}

/** The default value of every layer setting, for a new map. */
export function initialLayerSettings(mapId: number): LayerSettingParameter[] {
    return withMissingLayerSettings([], mapId);
}

/**
 * The stored values plus a default for every setting that has none (a
 * setting added to the registry after the map was saved). Values of settings
 * that are no longer in the registry are dropped.
 */
export function withMissingLayerSettings(stored: LayerSettingParameter[], mapId: number): LayerSettingParameter[] {
    const byKey = new Map(stored.map((s) => [settingKey(s), s]));
    return getAllLayerSettingsSetup().map((setup) => ({
        id: setup.id,
        layerId: setup.layerId,
        algorithmId: 0,
        providerId: 0,
        mapId,
        value: byKey.get(settingKey(setup))?.value ?? buildInitialValue(setup),
    }));
}

/**
 * Joins each setting value with its setup metadata (`key`, `styleType`,
 * `styleGroup`), which is never stored, into the views the UI works with.
 */
export function toLayerSettingViews(params: LayerSettingParameter[]): LayerSettingView[] {
    const setups = new Map(getAllLayerSettingsSetup().map((s) => [settingKey(s), s]));
    return params.flatMap((p) => {
        const s = setups.get(settingKey(p));
        return s ? [{ ...p, key: s.key, styleType: s.styleType, styleGroup: s.styleGroup }] : [];
    });
}
