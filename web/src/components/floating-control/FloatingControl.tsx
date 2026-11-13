import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFloatingControlZStore } from "./floatingControlZStore";

const MIN_WIDTH = 256;
const MIN_HEIGHT = 120;

interface FloatingControlProps {
    id: string;
    title: string;
    children: ReactNode;
    isOpen: boolean;
    onClose: () => void;
    defaultPosition?: { x: number; y: number };
    onPositionChange?: (position: { x: number; y: number }) => void;
    /** When true the header bar is hidden; the body is always visible and acts as the drag handle. */
    hideHeader?: boolean;
}

export default function FloatingControl({
    id,
    title,
    children,
    isOpen,
    onClose,
    defaultPosition = { x: 16, y: 16 },
    onPositionChange,
    hideHeader = false,
}: FloatingControlProps) {
    const windowRef = useRef<HTMLDivElement>(null);
    const isMountedRef = useRef(false);
    const [pos, setPos] = useState(defaultPosition);
    const [minimized, setMinimized] = useState(false);
    const [tooSmall, setTooSmall] = useState(false);

    // Tracks the current pos value across renders without causing re-renders.
    // Used by Effect 1 to detect whether setPos would be a no-op (same reference),
    // preventing posFromPropRef from being set when the effect would bail out.
    const posRef = useRef(pos);
    posRef.current = pos;

    // When true, the most recent pos change came from syncing the defaultPosition prop
    // (Effect 1) rather than from a user interaction (drag / clamp). Effect 2 checks
    // this flag and skips notifying the parent, breaking the circular feedback loop
    // that would otherwise cascade on rapid drag events.
    const posFromPropRef = useRef(false);

    const register = useFloatingControlZStore((s) => s.register);
    const bringToFront = useFloatingControlZStore((s) => s.bringToFront);
    const zIndex = useFloatingControlZStore((s) => s.getZIndex(id));

    useEffect(() => { register(id); }, [id, register]);

    // Effect 1: sync pos when the parent's defaultPosition values change.
    // Guard: if posRef already points at the exact same object as defaultPosition
    // (happens right after a drag propagates back through the store), setPos would
    // bail out anyway — skip so posFromPropRef is never set in that case.
    useEffect(() => {
        if (posRef.current === defaultPosition) return;
        posFromPropRef.current = true;
        setPos(defaultPosition);
    }, [defaultPosition.x, defaultPosition.y]);

    // Effect 2: notify the parent of user-driven position changes (drag, clamp, etc.).
    // posFromPropRef guards against re-notifying when Effect 1 was the source of the
    // pos change, preventing the circular loop: store → Effect 1 → pos → Effect 2 → store.
    useEffect(() => {
        if (!isMountedRef.current) { isMountedRef.current = true; return; }
        if (posFromPropRef.current) { posFromPropRef.current = false; return; }
        onPositionChange?.(pos);
    }, [onPositionChange, pos]);

    // Clamp position so the window stays within parent bounds
    function clampPos(x: number, y: number, parentW: number, parentH: number): { x: number; y: number } {
        const el = windowRef.current;
        const winW = el ? el.offsetWidth : MIN_WIDTH;
        const winH = el ? el.offsetHeight : 32;
        return {
            x: Math.max(0, Math.min(x, parentW - winW)),
            y: Math.max(0, Math.min(y, parentH - winH)),
        };
    }

    // ResizeObserver: track when parent is too small to show the window
    useEffect(() => {
        const el = windowRef.current;
        if (!el) return;

        const parent = el.offsetParent as HTMLElement | null;
        if (!parent) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width < MIN_WIDTH || height < MIN_HEIGHT) {
                    setTooSmall(true);
                } else {
                    setTooSmall(false);
                    // Clamp current position into the new bounds
                    setPos((prev) => clampPos(prev.x, prev.y, width, height));
                }
            }
        });

        observer.observe(parent);
        return () => observer.disconnect();
         
    }, [isOpen]);

    // Drag: only triggered from header mousedown
    function handleHeaderMouseDown(e: React.MouseEvent<HTMLDivElement>) {
        // Ignore clicks on the buttons in the header
        if ((e.target as HTMLElement).closest("button")) return;

        e.preventDefault();

        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const startPosX = pos.x;
        const startPosY = pos.y;

        const parent = windowRef.current?.offsetParent as HTMLElement | null;
        const parentRect = parent?.getBoundingClientRect() ?? { width: 0, height: 0 };

        function onMouseMove(ev: MouseEvent) {
            const rawX = startPosX + (ev.clientX - startMouseX);
            const rawY = startPosY + (ev.clientY - startMouseY);
            setPos(clampPos(rawX, rawY, parentRect.width, parentRect.height));
        }

        function onMouseUp() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        }

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    // When not open or parent is too small, still render the ref div (invisible)
    // so the ResizeObserver can attach. Hide via visibility/display instead.
    if (!isOpen || tooSmall) {
        // We need the ref to be mounted so ResizeObserver works even when hidden.
        // Render a zero-size invisible sentinel that stays in the DOM.
        return (
            <div
                ref={windowRef}
                className="absolute pointer-events-none"
                style={{ left: 0, top: 0, width: 0, height: 0 }}
                aria-hidden
            />
        );
    }

    return (
        <div
            ref={windowRef}
            className="absolute w-64 bg-gray-100 border border-gray-300 rounded shadow-md select-none"
            style={{ left: pos.x, top: pos.y, zIndex }}
            onMouseDown={(e) => { e.stopPropagation(); bringToFront(id); if (hideHeader) handleHeaderMouseDown(e); }}
            onKeyDown={(e) => e.stopPropagation()}
        >
            {/* Header */}
            {!hideHeader && (
                <div
                    className="flex items-center gap-1 px-3 h-8 border-b border-gray-300 rounded-t cursor-grab active:cursor-grabbing"
                    onMouseDown={handleHeaderMouseDown}
                >
                    <span className="flex-1 text-xs font-semibold text-gray-700 truncate select-none">
                        {title}
                    </span>

                    {/* Minimize button */}
                    <button
                        type="button"
                        aria-label={minimized ? "Expand" : "Minimize"}
                        onClick={() => setMinimized((m) => !m)}
                        className="flex items-center justify-center w-5 h-5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 active:bg-gray-300 transition-colors focus:outline-none cursor-pointer"
                    >
                        <span className="material-symbols-outlined leading-none" style={{ fontSize: 14 }}>
                            {minimized ? "expand_more" : "expand_less"}
                        </span>
                    </button>

                    {/* Close button */}
                    <button
                        type="button"
                        aria-label="Close"
                        onClick={onClose}
                        className="flex items-center justify-center w-5 h-5 rounded text-gray-400 hover:text-red-600 hover:bg-red-100 active:bg-red-200 transition-colors focus:outline-none cursor-pointer"
                    >
                        <span className="material-symbols-outlined leading-none" style={{ fontSize: 14 }}>
                            close
                        </span>
                    </button>
                </div>
            )}

            {/* Body */}
            {(hideHeader || !minimized) && (
                <div className={`flex flex-col bg-gray-50 py-2${hideHeader ? " rounded cursor-grab active:cursor-grabbing" : ""}`}>
                    {children}
                </div>
            )}
        </div>
    );
}
