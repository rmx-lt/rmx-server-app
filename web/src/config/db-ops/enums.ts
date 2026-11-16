// ─── Area Category ────────────────────────────────────────────────────────────

/**
 * The area categories the web app draws: the server's values (wiki Server-App,
 * "Planning API"). Navigation areas aren't drawn yet (rmx-server-app#81).
 */
export const AREA_CATEGORY = {
    MOWING: "mowing",
    NO_GO: "no_go",
} as const;

export type AreaCategory = (typeof AREA_CATEGORY)[keyof typeof AREA_CATEGORY];

export const AREA_CATEGORY_OPTIONS: { value: AreaCategory; label: string }[] = [
    { value: AREA_CATEGORY.MOWING, label: "Mowing area" },
    { value: AREA_CATEGORY.NO_GO, label: "No-go area" },
];
