/**
 * The three modes of the app and what each shows. A mode decides the canvas
 * tools (the tool strip), the visible canvas layers and the right panel's
 * content; there is no separate view switch. Users cannot change visibility.
 */

export type Mode = "mow" | "plan" | "drive";

export type LayerId = "areas" | "mower" | "draftBorder" | "jobPath" | "progress";

export const MODES: { id: Mode; label: string }[] = [
    { id: "mow", label: "Mow" },
    { id: "plan", label: "Plan" },
    { id: "drive", label: "Drive" },
];

/**
 * Layers per mode. Only `areas` is drawn today; the others have no data until
 * the mower features exist (rmx-server-app#93, #94, #105, #106).
 */
export const MODE_LAYERS: Record<Mode, readonly LayerId[]> = {
    plan: ["areas"],
    drive: ["areas", "mower", "draftBorder"],
    mow: ["areas", "jobPath", "progress", "mower"],
};

export function isLayerVisible(mode: Mode, layer: LayerId): boolean {
    return MODE_LAYERS[mode].includes(layer);
}
