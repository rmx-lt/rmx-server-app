import { create } from "zustand";

export type SaveMode = "session" | "manual" | "autosave";

const AUTOSAVE_STORAGE_KEY = "blade:autosave";

function readAutoSavePreference(): boolean {
    return localStorage.getItem(AUTOSAVE_STORAGE_KEY) === "true";
}

function persistAutoSavePreference(enabled: boolean): void {
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, String(enabled));
}

interface SaveModeState {
    mode: SaveMode;
    /** Whether the user has autosave turned on. Persisted in localStorage. */
    isAutoSaveEnabled: boolean;
    setMode: (mode: SaveMode) => void;
    /** Toggles the autosave preference and persists it. Call applyAutoSaveToggle() from workspaceBridge to also update mode. */
    setAutoSaveEnabled: (enabled: boolean) => void;
}

export const useSaveModeStore = create<SaveModeState>((set) => ({
    mode: "session",
    isAutoSaveEnabled: readAutoSavePreference(),
    setMode: (mode) => set({ mode }),
    setAutoSaveEnabled: (enabled) => {
        persistAutoSavePreference(enabled);
        set({ isAutoSaveEnabled: enabled });
    },
}));

/** Getter for use outside React (e.g. inside Zustand store action closures). */
export const getSaveMode = (): SaveMode => useSaveModeStore.getState().mode;
