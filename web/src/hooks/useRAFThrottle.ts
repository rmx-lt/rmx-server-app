import { useCallback, useEffect, useRef } from "react";

/**
 * RAF-throttled callback dispatcher.
 *
 * `schedule(value)` queues at most one animation frame per rAF slot, passing
 * the latest accumulated value to `callback`.
 *
 * - `schedule` — queue a value; callback fires once per animation frame with the latest value
 * - `flush`    — immediately invoke callback with the latest pending value (cancels any RAF)
 * - `cancel`   — cancel any pending RAF and discard the accumulated value
 *
 * All three returned functions are stable (no deps) — safe to include in
 * useCallback/useMemo dependency arrays without causing re-runs.
 */
export function useRAFThrottle<T>(callback: (value: T) => void): {
    schedule: (value: T) => void;
    flush: () => void;
    cancel: () => void;
} {
    // Keep a ref to the latest callback so schedule/flush/cancel can always be
    // stable (empty deps) while still calling the most-recent version.
    const callbackRef = useRef(callback);
    useEffect(() => { callbackRef.current = callback; });

    const pendingRef = useRef<T | null>(null);
    const rafIdRef = useRef<number | null>(null);

    const schedule = useCallback((value: T) => {
        pendingRef.current = value;
        if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
                if (pendingRef.current !== null) {
                    callbackRef.current(pendingRef.current);
                    pendingRef.current = null;
                }
                rafIdRef.current = null;
            });
        }
    }, []);

    const flush = useCallback(() => {
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
        if (pendingRef.current !== null) {
            callbackRef.current(pendingRef.current);
            pendingRef.current = null;
        }
    }, []);

    const cancel = useCallback(() => {
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
        pendingRef.current = null;
    }, []);

    useEffect(() => () => cancel(), [cancel]);

    return { schedule, flush, cancel };
}
