// ─── Zone Category ────────────────────────────────────────────────────────────

/**
 * The zone categories the web app draws: the server's values (wiki Server-App,
 * "Planning API"). Navigation zones aren't drawn yet (rmx-server-app#81).
 */
export const ZONE_CATEGORY = {
    MOWING: "mowing",
    NO_GO: "no_go",
} as const;

export type ZoneCategory = (typeof ZONE_CATEGORY)[keyof typeof ZONE_CATEGORY];

export const ZONE_CATEGORY_OPTIONS: { value: ZoneCategory; label: string }[] = [
    { value: ZONE_CATEGORY.MOWING, label: "Mowing zone" },
    { value: ZONE_CATEGORY.NO_GO, label: "No-go zone" },
];
