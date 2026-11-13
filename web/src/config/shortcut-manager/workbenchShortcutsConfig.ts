import type { ShortcutBindingConfig, ShortcutDisplayConfig } from "@/config/shortcut-manager/shortcutTypes";

export type { ShortcutBindingConfig, ShortcutDisplayConfig };

export const WORKBENCH_SHORTCUTS = {
    "workspace.new": {
        keys: "Ctrl+Alt+N",
        shortcut: ["Ctrl", "Alt", "N"],
    } satisfies ShortcutBindingConfig,
    "workspace.save-as": {
        keys: "Ctrl+Shift+S",
        shortcut: ["Ctrl", "Shift", "S"],
    } satisfies ShortcutBindingConfig,
    "workspace.open": {
        keys: "Ctrl+O",
        shortcut: ["Ctrl", "O"],
    } satisfies ShortcutBindingConfig,
    "workspace.save": {
        keys: "Ctrl+S",
        shortcut: ["Ctrl", "S"],
    } satisfies ShortcutBindingConfig,
    "controls.toggle": {
        keys: "Ctrl+Alt+C",
        shortcut: ["Ctrl", "Alt", "C"],
    } satisfies ShortcutBindingConfig,
    "inspector.toggle": {
        keys: "Ctrl+Alt+I",
        shortcut: ["Ctrl", "Alt", "I"],
    } satisfies ShortcutBindingConfig,
    "canvas.zoom-in": {
        shortcut: ["Alt", "Scroll Up"],
    } satisfies ShortcutDisplayConfig,
    "canvas.zoom-out": {
        shortcut: ["Alt", "Scroll Down"],
    } satisfies ShortcutDisplayConfig,
    "canvas.reset-view": {
        keys: "Ctrl+Shift+H",
        shortcut: ["Ctrl", "Shift", "H"],
    } satisfies ShortcutBindingConfig,
    "canvas.tool-select": {
        keys: "S",
        shortcut: ["S"],
    } satisfies ShortcutBindingConfig,
    "canvas.tool-add-zone": {
        keys: "Z",
        shortcut: ["Z"],
    } satisfies ShortcutBindingConfig,
    "canvas.tool-add-obstacle": {
        keys: "O",
        shortcut: ["O"],
    } satisfies ShortcutBindingConfig,
    "canvas.tool-delete": {
        keys: "D",
        shortcut: ["D"],
    } satisfies ShortcutBindingConfig,
    "canvas.undo": {
        keys: "Ctrl+Z",
        shortcut: ["Ctrl", "Z"],
    } satisfies ShortcutBindingConfig,
    "canvas.redo": {
        keys: "Ctrl+Y",
        shortcut: ["Ctrl", "Y"],
    } satisfies ShortcutBindingConfig,
};
