import { create } from "zustand";
import type { Mode } from "@/config/modes/modes";

/** The mode (Mow, Plan, Drive): decides the tool strip, the visible layers and the right panel. */
export const useModeStore = create<{ mode: Mode; setMode: (mode: Mode) => void }>()((set) => ({
    mode: "mow",
    setMode: (mode) => set({ mode }),
}));
