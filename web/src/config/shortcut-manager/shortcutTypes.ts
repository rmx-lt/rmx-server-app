export interface ShortcutDisplayConfig {
    /** Display tokens shown in MenuBarItem (e.g. ["Ctrl", "Alt", "C"]) */
    shortcut: string[];
}

export interface ShortcutBindingConfig extends ShortcutDisplayConfig {
    /** Shortcut string consumed by useShortcut / parseShortcut (e.g. "Ctrl+Alt+C") */
    keys: string;
}
