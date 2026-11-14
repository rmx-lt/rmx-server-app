import { db } from "./db";

export async function getUiPreference<T>(key: string, fallback: T): Promise<T> {
    const row = await db.table<{ key: string; value: string }>("uiPreferences").get(key);
    if (row == null) return fallback;
    try {
        return JSON.parse(row.value) as T;
    } catch {
        return fallback;
    }
}

export async function setUiPreference<T>(key: string, value: T): Promise<void> {
    await db.table<{ key: string; value: string }>("uiPreferences").put({ key, value: JSON.stringify(value) });
}
