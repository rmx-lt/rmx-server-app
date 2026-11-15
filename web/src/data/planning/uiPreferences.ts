import { getSetting, setSetting } from "./settings";

/** A UI preference of the user (a per-user setting on the server), or fallback. */
export function getUiPreference<T>(key: string, fallback: T): Promise<T> {
    return getSetting(key, fallback);
}

/** Stores a UI preference; failures are logged, the UI keeps working with its own state. */
export async function setUiPreference<T>(key: string, value: T): Promise<void> {
    try {
        await setSetting(key, value);
    } catch (err) {
        console.error(`saving preference ${key} failed`, err);
    }
}
