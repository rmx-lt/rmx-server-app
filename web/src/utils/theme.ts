/**
 * Theme: the user's choice (system, dark, light) is kept in localStorage; the
 * resolved theme is the `data-theme` attribute on <html>, which src/styles/index.css
 * turns into colours. public/index.html sets the attribute before first paint with
 * the same rules.
 */

export type ThemeChoice = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "rmx:theme";
const listeners = new Set<() => void>();

export function readThemeChoice(): ThemeChoice {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v === "dark" || v === "light" ? v : "system";
    } catch {
        return "system";
    }
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
    return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

const systemQuery = () => matchMedia("(prefers-color-scheme: dark)");

function apply() {
    document.documentElement.dataset.theme = resolveTheme(readThemeChoice(), systemQuery().matches);
    listeners.forEach((l) => l());
}

export function setThemeChoice(choice: ThemeChoice) {
    try {
        if (choice === "system") localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, choice);
    } catch {
        // Private mode: the choice lasts until reload.
    }
    apply();
}

/** Follows the system setting while the choice is "system". Call once at start. */
export function initTheme() {
    systemQuery().addEventListener("change", apply);
    apply();
}

export function subscribeTheme(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function currentTheme(): ResolvedTheme {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();

/** The canvas colours of the current theme (Konva needs concrete values, not var()). */
export function readCanvasColors() {
    return {
        grid: token("canvas-grid"),
        select: token("accent"),
        handle: token("canvas-handle"),
        midpoint: token("canvas-midpoint"),
        midpointEdge: token("canvas-midpoint-edge"),
        mowing: {
            stroke: token("canvas-mowing"),
            fill: token("canvas-mowing-fill"),
            fillHover: token("canvas-mowing-fill-hover"),
            fillSelected: token("canvas-mowing-fill-selected"),
        },
        no_go: {
            stroke: token("canvas-no-go"),
            fill: token("canvas-no-go-fill"),
            fillHover: token("canvas-no-go-fill-hover"),
            fillSelected: token("canvas-no-go-fill-selected"),
        },
    };
}
