import { useEffect, useRef } from "react";

/**
 * Attaches a mousedown listener and calls `onClickOutside` whenever a click
 * lands outside the returned ref's element. Only active while `isActive` is true.
 */
export function useClickOutside<T extends HTMLElement>(
    isActive: boolean,
    onClickOutside: () => void,
): React.RefObject<T | null> {
    const ref = useRef<T>(null);
    const callbackRef = useRef(onClickOutside);
    callbackRef.current = onClickOutside;

    useEffect(() => {
        if (!isActive) return;
        function handleMouseDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                callbackRef.current();
            }
        }
        document.addEventListener("mousedown", handleMouseDown);
        return () => document.removeEventListener("mousedown", handleMouseDown);
    }, [isActive]);

    return ref;
}
