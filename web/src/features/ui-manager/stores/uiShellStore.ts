import { create } from "zustand";
import { useModeStore } from "@/model/modeStore";
import type { Mode } from "@/config/modes/modes";

export type RightTab = "details" | "monitor";
export type SettingsPage = "account" | "appearance" | "map-defaults";

const wide = (px: number) => typeof matchMedia === "function" && matchMedia(`(min-width: ${px}px)`).matches;

export const PANEL_MIN = 224;
export const PANEL_MAX = 480;
const PANEL_DEFAULT = 288;
const WIDTHS_KEY = "rmx:panel-widths";

const clampWidth = (w: unknown) => (typeof w === "number" && Number.isFinite(w) ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w))) : PANEL_DEFAULT);

/** The panel widths of the last session; storage may be blocked or hold junk, then the defaults apply. */
function readWidths() {
    try {
        const v = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? "{}") as { side?: unknown; right?: unknown };
        return { sideWidth: clampWidth(v.side), rightWidth: clampWidth(v.right) };
    } catch {
        return { sideWidth: PANEL_DEFAULT, rightWidth: PANEL_DEFAULT };
    }
}

interface UiShellState {
    sideWidth: number;
    rightWidth: number;
    setPanelWidth: (panel: "side" | "right", width: number) => void;
    sideOpen: boolean;
    rightOpen: boolean;
    rightTab: RightTab;
    settingsOpen: boolean;
    settingsPage: SettingsPage;
    toggleSide: () => void;
    toggleRight: () => void;
    setSideOpen: (open: boolean) => void;
    setRightTab: (tab: RightTab) => void;
    openSettings: (page?: SettingsPage) => void;
    closeSettings: () => void;
    setSettingsPage: (page: SettingsPage) => void;
}

// The panels start open only where there is room for them next to the canvas.
export const useUiShellStore = create<UiShellState>()((set) => ({
    ...readWidths(),
    setPanelWidth: (panel, width) => {
        set(panel === "side" ? { sideWidth: clampWidth(width) } : { rightWidth: clampWidth(width) });
        const { sideWidth, rightWidth } = useUiShellStore.getState();
        try {
            localStorage.setItem(WIDTHS_KEY, JSON.stringify({ side: sideWidth, right: rightWidth }));
        } catch {
            // Not remembered; the default width applies next time.
        }
    },
    sideOpen: wide(768),
    rightOpen: wide(1024),
    rightTab: "details",
    settingsOpen: false,
    settingsPage: "account",
    // Where a panel floats over the canvas (narrow window), opening one closes the other.
    toggleSide: () => set((s) => ({ sideOpen: !s.sideOpen, rightOpen: s.rightOpen && (s.sideOpen || wide(1024)) })),
    toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen, sideOpen: s.sideOpen && (s.rightOpen || wide(768)) })),
    setSideOpen: (sideOpen) => set({ sideOpen }),
    setRightTab: (rightTab) => set({ rightTab }),
    openSettings: (page) => set((s) => ({ settingsOpen: true, settingsPage: page ?? s.settingsPage })),
    closeSettings: () => set({ settingsOpen: false }),
    setSettingsPage: (settingsPage) => set({ settingsPage }),
}));

/** The mode decides the right panel's content: the mower's monitor while driving or mowing, the plan's details while planning. */
const TAB_OF_MODE: Record<Mode, RightTab> = { plan: "details", drive: "monitor", mow: "monitor" };
useModeStore.subscribe((s, prev) => {
    if (s.mode !== prev.mode) useUiShellStore.setState({ rightTab: TAB_OF_MODE[s.mode] });
});
