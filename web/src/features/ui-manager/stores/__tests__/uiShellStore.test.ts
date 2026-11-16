import { expect, test } from "bun:test";

const store = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });

test("a panel width stays between the limits and is remembered", async () => {
    const { PANEL_MAX, PANEL_MIN, useUiShellStore } = await import("../uiShellStore");
    useUiShellStore.getState().setPanelWidth("side", 9999);
    useUiShellStore.getState().setPanelWidth("right", 10);
    expect(useUiShellStore.getState().sideWidth).toBe(PANEL_MAX);
    expect(useUiShellStore.getState().rightWidth).toBe(PANEL_MIN);
    expect(JSON.parse(store.get("rmx:panel-widths")!)).toEqual({ side: PANEL_MAX, right: PANEL_MIN });
});
