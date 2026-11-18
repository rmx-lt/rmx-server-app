import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 500;
const GAP = 6;
const MARGIN = 8;

type Trigger = ReactElement<Record<string, unknown>>;

/**
 * A tooltip for the one control it wraps: the label and, when there is one,
 * the shortcut. Shows after a short hover and at once on keyboard focus; hides
 * on Escape, on press and when the pointer or focus leaves. The control gets
 * `aria-describedby` to the tip, so screen readers read it as the description.
 * The tip is drawn in a portal, so no overflow or transform of a parent clips it,
 * and it is moved inside the window.
 */
export default function Tooltip({ label, shortcut, children }: { label: string; shortcut?: readonly string[]; children: Trigger }) {
    const id = useId();
    const tipRef = useRef<HTMLSpanElement>(null);
    // The control the pointer or focus is on, and whether its delay has passed.
    const [target, setTarget] = useState<{ rect: DOMRect; delay: number } | null>(null);
    const [shown, setShown] = useState(false);
    const open = target !== null && shown;

    const hide = () => {
        setTarget(null);
        setShown(false);
    };
    const show = (el: Element, delay: number) => setTarget({ rect: el.getBoundingClientRect(), delay });

    useEffect(() => {
        if (!target) return;
        const timer = setTimeout(() => setShown(true), target.delay);
        return () => clearTimeout(timer);
    }, [target]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") hide();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    // Below the control, centred; above it when there is no room; always inside the window.
    useLayoutEffect(() => {
        const tip = tipRef.current;
        if (!tip || !target || !shown) return;
        const anchor = target.rect;
        const { width, height } = tip.getBoundingClientRect();
        const below = anchor.bottom + GAP + height <= window.innerHeight - MARGIN;
        const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, MARGIN), Math.max(MARGIN, window.innerWidth - width - MARGIN));
        tip.style.left = `${left}px`;
        tip.style.top = `${below ? anchor.bottom + GAP : Math.max(MARGIN, anchor.top - GAP - height)}px`;
    }, [target, shown]);

    const own = children.props as {
        onPointerEnter?: (e: PointerEvent) => void;
        onPointerLeave?: (e: PointerEvent) => void;
        onPointerDown?: (e: PointerEvent) => void;
        onFocus?: (e: FocusEvent) => void;
        onBlur?: (e: FocusEvent) => void;
        "aria-describedby"?: string;
    };

    const trigger = cloneElement(children, {
        "aria-describedby": own["aria-describedby"] ? `${own["aria-describedby"]} ${id}` : id,
        onPointerEnter: (e: PointerEvent) => {
            own.onPointerEnter?.(e);
            if (e.pointerType !== "touch") show(e.currentTarget, SHOW_DELAY_MS);
        },
        onPointerLeave: (e: PointerEvent) => {
            own.onPointerLeave?.(e);
            hide();
        },
        onPointerDown: (e: PointerEvent) => {
            own.onPointerDown?.(e);
            hide();
        },
        onFocus: (e: FocusEvent) => {
            own.onFocus?.(e);
            // Keyboard focus only: a click also focuses, and should not show it.
            if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, 0);
        },
        onBlur: (e: FocusEvent) => {
            own.onBlur?.(e);
            hide();
        },
    });

    return (
        <>
            {trigger}
            {createPortal(
                <span
                    ref={tipRef}
                    id={id}
                    role="tooltip"
                    className={`pointer-events-none fixed top-0 left-0 z-[60] flex max-w-[min(20rem,calc(100vw-1rem))] items-center gap-2 rounded-lg bg-tooltip px-2.5 py-1.5 text-xs font-medium text-on-tooltip shadow-lg ring-1 ring-line ${open ? "" : "invisible"}`}
                >
                    <span>{label}</span>
                    {shortcut && shortcut.length > 0 && <span className="shrink-0 font-normal text-tooltip-muted">{shortcut.join("+")}</span>}
                </span>,
                document.body,
            )}
        </>
    );
}
