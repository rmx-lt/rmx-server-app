import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createAutosaver } from "@/data/planning/autosave";

const TIMES = { debounceMs: 20, retryMinMs: 20, retryMaxMs: 80 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const realError = console.error;
beforeEach(() => {
    console.error = () => {};
});
afterEach(() => {
    console.error = realError;
});

describe("autosave", () => {
    test("a burst of changes is one save", async () => {
        let saves = 0;
        const a = createAutosaver(async () => void saves++, TIMES);
        a.request();
        a.request();
        a.request();
        expect(saves).toBe(0);
        await wait(60);
        expect(saves).toBe(1);
    });

    test("nothing waiting, nothing saved", async () => {
        let saves = 0;
        const a = createAutosaver(async () => void saves++, TIMES);
        await a.flush();
        a.retryNow();
        await wait(40);
        expect(saves).toBe(0);
    });

    test("a failed save is retried with a growing pause until it works", async () => {
        const at: number[] = [];
        let fail = 3;
        const a = createAutosaver(async () => {
            at.push(Date.now());
            if (fail-- > 0) throw new Error("offline");
        }, TIMES);
        a.request();
        await wait(300);
        expect(at.length).toBe(4);
        await wait(150);
        expect(at.length).toBe(4); // saved: no more tries
        // pauses: 20, 40, 80 (capped at 80 afterwards)
        expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(35);
        expect(at[3]! - at[2]!).toBeGreaterThanOrEqual(70);
    });

    test("changes made offline are sent at once when the connection returns", async () => {
        let online = false;
        let saves = 0;
        const a = createAutosaver(async () => {
            if (!online) throw new Error("offline");
            saves++;
        }, { debounceMs: 10, retryMinMs: 5000, retryMaxMs: 5000 });
        a.request();
        await wait(40);
        expect(saves).toBe(0);
        online = true;
        a.retryNow();
        await wait(10);
        expect(saves).toBe(1);
    });

    test("a change made while a save runs is saved after it", async () => {
        const saved: number[] = [];
        let n = 0;
        const a = createAutosaver(async () => {
            const mine = ++n;
            await wait(30);
            saved.push(mine);
        }, TIMES);
        a.request();
        await wait(35); // first save is running
        a.request();
        await wait(150);
        expect(saved).toEqual([1, 2]);
    });

    test("flush saves what waits, and throws when it still fails", async () => {
        let ok = true;
        let saves = 0;
        const a = createAutosaver(async () => {
            saves++;
            if (!ok) throw new Error("offline");
        }, { debounceMs: 5000, retryMinMs: 5000, retryMaxMs: 5000 });
        a.request();
        await a.flush();
        expect(saves).toBe(1);
        ok = false;
        a.request();
        await expect(a.flush()).rejects.toThrow("could not be saved");
        a.reset();
    });

    test("reset forgets what waits", async () => {
        let saves = 0;
        const a = createAutosaver(async () => void saves++, TIMES);
        a.request();
        a.reset();
        await wait(50);
        expect(saves).toBe(0);
    });
});
