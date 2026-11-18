import { create } from "zustand";

/** Which page shows: Home (the maps) or the workbench (the open map). No router: this is the whole navigation. */
export type Page = "home" | "workbench";

const LAST_MAP_KEY = "rmx:last-map";

/** The id of the map opened last in this browser, or null. */
export function readLastMapId(): number | null {
    try {
        const id = Number(localStorage.getItem(LAST_MAP_KEY));
        return Number.isInteger(id) && id > 0 ? id : null;
    } catch {
        return null;
    }
}

/** Remembers the map opened last (null forgets it). Storage may be blocked; then nothing is kept. */
export function rememberLastMapId(id: number | null): void {
    try {
        if (id === null || id <= 0) localStorage.removeItem(LAST_MAP_KEY);
        else localStorage.setItem(LAST_MAP_KEY, String(id));
    } catch {
        // Not remembered; the next start shows Home.
    }
}

export const usePageStore = create<{ page: Page; setPage: (page: Page) => void }>()((set) => ({
    // Home right away for a first visit, so the workbench does not flash.
    page: readLastMapId() === null ? "home" : "workbench",
    setPage: (page) => set({ page }),
}));
