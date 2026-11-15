// Saves the open map by itself: a moment after the last change (a burst of
// edits is one save), again after a failed save with a growing pause, and
// again when the connection returns. save() throws when it fails.

export interface Autosaver {
    /** Something changed: save soon. */
    request(): void;
    /** Saves now when something is waiting; throws when the changes still could not be saved. */
    flush(): Promise<void>;
    /** Forgets what is waiting (another map was shown). */
    reset(): void;
    /** Tries a waiting save at once (the connection came back). */
    retryNow(): void;
}

export interface AutosaveTimes {
    debounceMs: number;
    retryMinMs: number;
    retryMaxMs: number;
}

export const AUTOSAVE_TIMES: AutosaveTimes = { debounceMs: 1000, retryMinMs: 1000, retryMaxMs: 15_000 };

export function createAutosaver(save: () => Promise<void>, times: AutosaveTimes = AUTOSAVE_TIMES): Autosaver {
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: Promise<boolean> | undefined;
    let retryMs = times.retryMinMs;

    const schedule = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => void run(), ms);
    };

    async function attempt(): Promise<boolean> {
        if (!dirty) return true;
        // Cleared before the save: a change made while it runs sets it again.
        dirty = false;
        try {
            await save();
        } catch (err) {
            console.error("saving the map failed, will retry", err);
            dirty = true;
            schedule(retryMs);
            retryMs = Math.min(retryMs * 2, times.retryMaxMs);
            return false;
        }
        retryMs = times.retryMinMs;
        if (dirty) schedule(times.debounceMs);
        return true;
    }

    function run(): Promise<boolean> {
        clearTimeout(timer);
        inflight ??= attempt().finally(() => {
            inflight = undefined;
        });
        return inflight;
    }

    return {
        request() {
            dirty = true;
            schedule(times.debounceMs);
        },
        async flush() {
            await run();
            if (dirty && !(await run())) throw new Error("Your latest changes could not be saved yet.");
        },
        reset() {
            dirty = false;
            retryMs = times.retryMinMs;
            clearTimeout(timer);
        },
        retryNow() {
            if (!dirty) return;
            retryMs = times.retryMinMs;
            void run();
        },
    };
}
