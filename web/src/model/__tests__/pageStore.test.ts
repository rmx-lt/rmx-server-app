import { afterEach, expect, test } from "bun:test";
import { readLastMapId, rememberLastMapId } from "../pageStore";

const store = new Map<string, string>();
const working = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
};
Object.assign(globalThis, { localStorage: working });
afterEach(() => {
    store.clear();
    Object.assign(globalThis, { localStorage: working });
});

test("the last map id is kept and forgotten", () => {
    expect(readLastMapId()).toBeNull();
    rememberLastMapId(7);
    expect(readLastMapId()).toBe(7);
    rememberLastMapId(null);
    expect(readLastMapId()).toBeNull();
});

test("a bad stored value reads as none", () => {
    store.set("rmx:last-map", "abc");
    expect(readLastMapId()).toBeNull();
});

test("a blocked storage reads as none and does not throw", () => {
    const blocked = () => {
        throw new Error("blocked");
    };
    Object.assign(globalThis, { localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    expect(readLastMapId()).toBeNull();
    expect(() => rememberLastMapId(3)).not.toThrow();
});
