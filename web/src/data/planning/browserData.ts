/**
 * Deletes the IndexedDB database where earlier versions of the web app kept
 * maps and settings ("blade-terminal"). They now live on the server; the old
 * copy is not imported (the app was not in use yet).
 */
export function forgetBrowserData(): void {
    try {
        globalThis.indexedDB?.deleteDatabase("blade-terminal");
    } catch {
        // No IndexedDB (tests, private mode): nothing to forget.
    }
}
