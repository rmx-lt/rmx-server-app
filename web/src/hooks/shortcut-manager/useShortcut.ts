import { useEffect, useRef } from "react";
import { parseShortcut, type ParsedShortcut } from "@/utils/parseShortcut";

export interface ShortcutEntry {
    parsed: ParsedShortcut;
    handler: () => void;
}

/**
 * Module-level registry shared between useShortcut and ShortcutManager.
 * Keyed by a stable shortcut id (e.g. "inspector.toggle").
 * Functions are not stored in Zustand — this plain Map avoids serialization issues.
 */
export const shortcutRegistry = new Map<string, ShortcutEntry>();

/**
 * Active blocker tokens. Shortcuts are suppressed while this Set is non-empty.
 * Use blockShortcuts / unblockShortcuts to manage tokens imperatively, or
 * use the useShortcutsBlocked hook for a React lifecycle-aware version.
 */
export const shortcutBlockers = new Set<string>();

/**
 * Callbacks invoked when the first blocker is added (shortcuts go from enabled → disabled).
 * Register with addShortcutBlockListener / removeShortcutBlockListener.
 */
const shortcutBlockListeners = new Set<() => void>();

export function addShortcutBlockListener(fn: () => void) {
    shortcutBlockListeners.add(fn);
}

export function removeShortcutBlockListener(fn: () => void) {
    shortcutBlockListeners.delete(fn);
}

export function blockShortcuts(token: string) {
    const wasEmpty = shortcutBlockers.size === 0;
    shortcutBlockers.add(token);
    if (wasEmpty) {
        for (const fn of shortcutBlockListeners) fn();
    }
}

export function unblockShortcuts(token: string) {
    shortcutBlockers.delete(token);
}

/**
 * Register a keyboard shortcut from a React component.
 *
 * @param id      Stable unique identifier (e.g. "inspector.toggle"). Prevents duplicate registrations.
 * @param keys    Shortcut string (e.g. "Ctrl+Alt+I").
 * @param handler Function to call when the shortcut fires.
 *
 * @example
 * useShortcut("inspector.toggle", "Ctrl+Alt+I", () => setVisibility(!isVisible));
 * useShortcut("canvas.delete", "Delete", handleDelete);
 */
export function useShortcut(
    id: string,
    keys: string,
    handler: () => void,
) {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        shortcutRegistry.set(id, {
            parsed: parseShortcut(keys),
            handler: () => handlerRef.current(),
        });

        return () => {
            shortcutRegistry.delete(id);
        };
    }, [id, keys]);
}
