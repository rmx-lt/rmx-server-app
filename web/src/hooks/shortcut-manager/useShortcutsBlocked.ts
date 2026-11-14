import { useEffect } from "react";
import { blockShortcuts, unblockShortcuts } from "./useShortcut";

/**
 * Blocks all global shortcuts while `active` is true.
 *
 * Uses a named token so multiple independent blockers can coexist —
 * shortcuts only resume when every blocker has been removed.
 *
 * @param token  Stable string that identifies this blocker (e.g. "workspace-picker-modal").
 * @param active Whether the block is currently active.
 *
 * @example
 * useShortcutsBlocked("workspace-picker-modal", isOpen);
 * useShortcutsBlocked("workspace-name-field", isEditing);
 */
export function useShortcutsBlocked(token: string, active: boolean) {
    useEffect(() => {
        if (active) {
            blockShortcuts(token);
        } else {
            unblockShortcuts(token);
        }

        return () => {
            unblockShortcuts(token);
        };
    }, [token, active]);
}
