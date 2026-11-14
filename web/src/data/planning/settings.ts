import { fetchSettings, putSetting, removeSetting } from "@/data/api/planning";

// The user's settings, kept on the server (GET/PUT /app/api/settings) and
// read once per login into this cache. Writes update the cache at once and
// go to the server in the background.

let cache: Promise<Map<string, unknown>> | null = null;

function settings(): Promise<Map<string, unknown>> {
    cache ??= fetchSettings().then((list) => new Map(list.map((s) => [s.key, s.value])));
    // A failed load is retried on the next read instead of being cached.
    cache.catch(() => {
        cache = null;
    });
    return cache;
}

/** Forgets the cached settings; the next read loads them again (call after a login). */
export function resetSettings(): void {
    cache = null;
}

/** The value stored under key, or fallback when there is none or the server can't be reached. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
    try {
        const all = await settings();
        return all.has(key) ? (all.get(key) as T) : fallback;
    } catch (err) {
        console.error(`loading setting ${key} failed`, err);
        return fallback;
    }
}

/** Stores value under key; null or undefined removes the key. */
export async function setSetting(key: string, value: unknown): Promise<void> {
    const all = await settings().catch(() => null);
    if (value === null || value === undefined) {
        all?.delete(key);
        await removeSetting(key);
    } else {
        all?.set(key, value);
        await putSetting(key, value);
    }
}
