import { useEffect } from "react";
import { shortcutRegistry, shortcutBlockers } from "@/hooks/shortcut-manager/useShortcut";
import { matchesShortcut } from "@/utils/parseShortcut";

/**
 * Renderless component — mount once in the app shell.
 * Owns the single global keydown listener that dispatches to registered shortcuts.
 */
export default function ShortcutManager() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shortcutBlockers.size > 0) return;

      for (const [, entry] of shortcutRegistry) {
        if (!matchesShortcut(e, entry.parsed)) continue;

        e.preventDefault();

        entry.handler();
        break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}
