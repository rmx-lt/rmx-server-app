import { memo, useEffect, useRef, useState } from "react";
import { useFloatingControlZStore } from "@/components/floating-control/floatingControlZStore";
import { useCppDebugStore } from "@/features/coverage-planning/stores/cppDebugStore";
import { fastForwardDebugSession, stepDebugSession, restartDebugSession, stopDebugSession } from "@/features/coverage-planning/data/debugService";

const CONTROL_ID = "cpp-debug";

function CppDebugFloatingControl() {
    const containerRef = useRef<HTMLDivElement>(null);

    const isOpen = useCppDebugStore((s) => s.isOpen);
    const controlPosition = useCppDebugStore((s) => s.controlPosition);
    const setControlPosition = useCppDebugStore((s) => s.setControlPosition);
    const currentStep = useCppDebugStore((s) => s.currentStep);
    const totalSteps = useCppDebugStore((s) => s.totalSteps);

    const [pos, setPos] = useState(controlPosition);
    const [isRunning, setIsRunning] = useState(false);
    const [isAutoStepping, setIsAutoStepping] = useState(false);
    const isAutoSteppingRef = useRef(false);
    const isMountedRef = useRef(false);

    // Mirror of pos kept in a ref so Effect 1 can check reference equality
    // without adding pos to the dependency array.
    const posRef = useRef(pos);
    posRef.current = pos;

    // When true, the most recent pos change came from Effect 1 syncing the store
    // value rather than from a user drag / resize clamp. Effect 2 skips the
    // setControlPosition call in that case, breaking the circular feedback loop.
    const posFromPropRef = useRef(false);

    const isDone = totalSteps > 0 && currentStep >= totalSteps;

    const register = useFloatingControlZStore((s) => s.register);
    const bringToFront = useFloatingControlZStore((s) => s.bringToFront);
    const zIndex = useFloatingControlZStore((s) => s.getZIndex(CONTROL_ID));

    useEffect(() => { register(CONTROL_ID); }, [register]);

    // Effect 1: sync pos when store's controlPosition values change.
    // Guard: skip when posRef already holds the exact same object as controlPosition
    // (happens right after a drag propagated back through the store) to avoid
    // setting posFromPropRef when setPos would bail out anyway.
    useEffect(() => {
        if (posRef.current === controlPosition) return;
        posFromPropRef.current = true;
        setPos(controlPosition);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controlPosition.x, controlPosition.y]);

    // Effect 2: persist user-driven position changes (drag, clamp) back to the store.
    // posFromPropRef prevents re-writing the store when Effect 1 was the source of the
    // change, eliminating the circular loop: store → Effect 1 → pos → Effect 2 → store.
    useEffect(() => {
        if (!isMountedRef.current) { isMountedRef.current = true; return; }
        if (posFromPropRef.current) { posFromPropRef.current = false; return; }
        setControlPosition(pos);
    }, [setControlPosition, pos]);

    function clampPos(x: number, y: number, parentW: number, parentH: number): { x: number; y: number } {
        const el = containerRef.current;
        const elW = el ? el.offsetWidth : 180;
        const elH = el ? el.offsetHeight : 40;
        return {
            x: Math.max(0, Math.min(x, parentW - elW)),
            y: Math.max(0, Math.min(y, parentH - elH)),
        };
    }

    // Clamp position when parent resizes
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const parent = el.offsetParent as HTMLElement | null;
        if (!parent) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setPos((prev) => clampPos(prev.x, prev.y, width, height));
            }
        });

        observer.observe(parent);
        return () => observer.disconnect();
         
    }, [isOpen]);

    async function handleResumePause() {
        if (isAutoStepping) {
            isAutoSteppingRef.current = false;
            setIsAutoStepping(false);
            return;
        }

        isAutoSteppingRef.current = true;
        setIsAutoStepping(true);

        while (isAutoSteppingRef.current) {
            const result = await stepDebugSession();
            if (!result.ok || result.done) {
                isAutoSteppingRef.current = false;
                setIsAutoStepping(false);
                break;
            }
        }
    }

    function handleDragMouseDown(e: React.MouseEvent<HTMLDivElement>) {
        e.preventDefault();
        e.stopPropagation();

        const startMouseX = e.clientX;
        const startMouseY = e.clientY;
        const startPosX = pos.x;
        const startPosY = pos.y;

        const parent = containerRef.current?.offsetParent as HTMLElement | null;
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

    if (!isOpen) {
        return (
            <div
                ref={containerRef}
                className="absolute pointer-events-none"
                style={{ left: 0, top: 0, width: 0, height: 0 }}
                aria-hidden
            />
        );
    }

    return (
        <div
            ref={containerRef}
            className="absolute flex items-center px-0.5 py-0.5 bg-gray-100 border border-gray-300 rounded shadow-md select-none"
            style={{ left: pos.x, top: pos.y, zIndex }}
            onMouseDown={() => bringToFront(CONTROL_ID)}
            onKeyDown={(e) => e.stopPropagation()}
        >
            {/* Drag handle — only interactive element for moving */}
            <div
                className="flex items-center justify-center w-7 h-8 text-gray-400 cursor-grab active:cursor-grabbing hover:text-gray-600 hover:bg-gray-200 rounded-l transition-colors"
                onMouseDown={handleDragMouseDown}
                title="Move"
            >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    drag_indicator
                </span>
            </div>

            {/* Separator */}
            <div className="mx-0.5 w-px h-6 bg-gray-300 shrink-0" />

            {/* Action buttons */}
            <div className="flex items-center gap-0.5">
                {/* Continue */}
                <button
                    type="button"
                    title="Fast Forward"
                    disabled={isDone || isRunning || isAutoStepping}
                    onClick={() => {
                        setIsRunning(true);
                        void fastForwardDebugSession().finally(() => setIsRunning(false));
                    }}
                    className="flex items-center justify-center w-8 h-8 rounded text-sky-500 hover:text-sky-700 hover:bg-gray-200 active:bg-gray-300 cursor-pointer transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sky-500"
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        fast_forward
                    </span>
                </button>

                {/* Resume / Pause */}
                <button
                    type="button"
                    title={isAutoStepping ? "Pause" : "Resume"}
                    disabled={(isDone && !isAutoStepping) || isRunning}
                    onClick={() => { void handleResumePause(); }}
                    className="flex items-center justify-center w-8 h-8 rounded text-sky-500 hover:text-sky-700 hover:bg-gray-200 active:bg-gray-300 cursor-pointer transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sky-500"
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        {isAutoStepping ? "pause" : "play_arrow"}
                    </span>
                </button>

                {/* Step Over */}
                <button
                    type="button"
                    title="Step Over"
                    disabled={isDone || isRunning || isAutoStepping}
                    onClick={() => { void stepDebugSession(); }}
                    className="flex items-center justify-center w-8 h-8 rounded text-sky-500 hover:text-sky-700 hover:bg-gray-200 active:bg-gray-300 cursor-pointer transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sky-500"
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        step_over
                    </span>
                </button>

                {/* Restart */}
                <button
                    type="button"
                    title="Restart"
                    disabled={isRunning || isAutoStepping}
                    onClick={() => { void restartDebugSession(); }}
                    className="flex items-center justify-center w-8 h-8 rounded text-emerald-500 hover:text-emerald-700 hover:bg-gray-200 active:bg-gray-300 cursor-pointer transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-emerald-500"
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        restart_alt
                    </span>
                </button>

                {/* Stop */}
                <button
                    type="button"
                    title="Stop"
                    onClick={() => { void stopDebugSession(); }}
                    className="flex items-center justify-center w-8 h-8 rounded text-red-500 hover:text-red-700 hover:bg-red-100 active:bg-red-200 cursor-pointer transition-colors focus:outline-none"
                >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        stop
                    </span>
                </button>
            </div>
        </div>
    );
}

export default memo(CppDebugFloatingControl);
