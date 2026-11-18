import { useMemo, useSyncExternalStore } from "react";
import { currentTheme, readCanvasColors, readThemeChoice, subscribeTheme } from "@/utils/theme";

export function useThemeChoice() {
    return useSyncExternalStore(subscribeTheme, readThemeChoice);
}

/** Canvas colours; re-read when the theme changes, so the canvas follows without a reload. */
export function useCanvasColors() {
    const theme = useSyncExternalStore(subscribeTheme, currentTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme is the trigger, not an input
    return useMemo(() => readCanvasColors(), [theme]);
}
