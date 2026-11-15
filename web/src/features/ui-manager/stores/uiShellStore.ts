import { create } from "zustand";
import { useModeStore } from "@/model/modeStore";
import type { Mode } from "@/config/modes/modes";

export type RightTab = "details" | "monitor";
export type SettingsPage = "account" | "appearance" | "map-defaults";

const wide = (px: number) => typeof matchMedia === "function" && matchMedia(`(min-width: ${px}px)`).matches;

interface UiShellState {
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
