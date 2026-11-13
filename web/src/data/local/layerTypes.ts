import type { PointLabelColorEntry, StyleAttributeGroup, StyleAttributeKey, StyleType } from "@/data/local/serviceTypes";

export type LayerId = number;

/**
 * Typed layer kinds.
 * - "Polygon" | "Point" | "Line" — mirror the API DebugLayerType for compute result layers.
 *   Obstacles and Zones are "Polygon"; future debug layers from the provider will use Point/Line.
 * - "Grid" — internal canvas utility layer.
 * - "ObjectGroup" — a dedicated settings-owner layer for a group of polygon object types.
 *   It stores group-level settings (e.g. "Show Vertex IDs") but never renders standalone.
 */
export type LayerType = "Polygon" | "Point" | "Line" | "Grid" | "ObjectGroup" | "EnvPoints" | "Map";

/**
 * Attribute keys managed internally by the terminal (not part of the provider metadata spec).
 * These are seeded as part of the system layer defaults.
 */
export type InternalStyleAttributeKey =
    | "Show Vertex IDs"
    | "Grid Line Color"
    | "Coverage Grid Cell Size"
    | "Coverage Grid Show Grid"
    | "Coverage Grid Line Color"
    | "Coverage Grid Line Width"
    | "Coverage Grid Fill Opacity"
    | "Point Label Enum Values"
    | "Start Point Color"
    | "Start Point Radius"
    | "Start Point Stroke Color"
    | "End Point Color"
    | "End Point Radius"
    | "End Point Stroke Color"
    | "Start & End Point Color"
    | "Start & End Point Radius"
    | "Start & End Point Stroke Color"
    | "Map Opacity";

export interface LayerDefinition {
    id: LayerId;
    name: string;
    type: LayerType;
}

/**
 * DB record for the `layerSettingsSetup` table.
 * Stores the full attribute metadata fetched from a provider (or seeded for system layers).
 * This is the source-of-truth template from which per-environment `layerSettings` rows are initialized.
 * System layers use `algorithmId: 0, providerId: 0`.
 */
export interface LayerSettingsSetup {
    /** API attribute ID — part of the compound PK. */
    id: number;
    /** FK → layers.id */
    layerId: LayerId;
    algorithmId: number;
    providerId: number;
    /** Human-readable attribute key — doubles as the display label. */
    key: StyleAttributeKey | InternalStyleAttributeKey;
    /** Attribute value type from the provider spec. */
    styleType: StyleType;
    /** Which API style subgroup this attribute belongs to. Absent for internal attributes (e.g. Show Vertex IDs). */
    styleGroup?: StyleAttributeGroup;
    defaultValue: string | null;
    /** Allowed enum values — populated for "PointLabelEnum" rows. */
    enumValues?: string[];
    /** Per-value color overrides — populated for "PointLabelEnum" rows. */
    mapping?: PointLabelColorEntry[];
}

/** Compound primary key for the `layers` table. System layers use `algorithmId: 0, providerId: 0`. */
export interface LayerPK {
    id: number;
    algorithmId: number;
    providerId: number;
}

/**
 * DB record for a canvas layer definition (`layers` table).
 * `id` is a natural key from the layer definition or provider metadata.
 * System layers use `algorithmId: 0, providerId: 0` as sentinels.
 * `type` is optional for backward compatibility with DB records that pre-date the type field.
 * `computeLayer` is the algorithm-specific channel key used to extract result data (e.g. "coveragePathPlan").
 * Optional for backward compatibility — pre-existing DB records without this field fall back to `label`.
 */
export interface LayerRecord {
    id: number;
    algorithmId: number;
    providerId: number;
    label: string;
    computeLayer?: string;
    type?: LayerType;
}

/**
 * DB record for the `layerSettings` table.
 * Per-environment working copy initialized from `layerSettingsSetup`.
 * Each environment holds its own independent copy for all layers (system + provider).
 * Only the mutable `value` field is stored — metadata fields (`key`, `styleType`,
 * `styleGroup`) live exclusively in `layerSettingsSetup` and are joined at load time.
 */
export interface LayerSettingParameter {
    /** API attribute ID — part of the compound PK. Matches `LayerSettingsSetup.id`. */
    id: number;
    /** FK → layers.id */
    layerId: number;
    algorithmId: number;
    providerId: number;
    /** FK → environments.id */
    environmentId: number;
    value: string;
}

/**
 * In-memory view of a `layerSettings` row joined with its `layerSettingsSetup` metadata.
 * `key`, `styleType`, and `styleGroup` are sourced from `LayerSettingsSetup` at load time
 * and are never persisted back to the `layerSettings` table.
 */
export interface LayerSettingView extends LayerSettingParameter {
    /** Attribute key — joined from `LayerSettingsSetup`, used as the display label. */
    key: StyleAttributeKey | InternalStyleAttributeKey;
    /** Attribute value type — joined from setup, drives input widget selection. */
    styleType: StyleType;
    /** Style subgroup — joined from setup, drives section grouping in the panel. Absent for internal attributes. */
    styleGroup?: StyleAttributeGroup;
}

export interface LayerWithSettings {
    layer: LayerRecord;
    settings: LayerSettingView[];
}
