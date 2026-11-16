import type { PointerEvent } from "react";
import { PANEL_MIN, useUiShellStore } from "@/features/ui-manager/stores/uiShellStore";

/**
 * Drag handle on the inner edge of a side panel (desktop widths only). One drag does it all: the width follows the cursor
 * between the limits; past half of the minimum width the panel closes, and back past it, it opens again.
 * The listeners are on the window, because the handle itself unmounts when the panel closes.
 */
export default function PanelResizeHandle({ side }: { side: "left" | "right" }) {
    const onPointerDown = (e: PointerEvent) => {
        e.preventDefault();
        const store = useUiShellStore.getState();
        const panel = side === "left" ? "side" : "right";
        const startX = e.clientX;
        const startWidth = panel === "side" ? store.sideWidth : store.rightWidth;
        const dir = side === "left" ? 1 : -1;

        const move = (m: globalThis.PointerEvent) => {
            const raw = startWidth + (m.clientX - startX) * dir;
            const s = useUiShellStore.getState();
            const open = raw >= PANEL_MIN / 2;
            if (open !== (panel === "side" ? s.sideOpen : s.rightOpen)) useUiShellStore.setState(panel === "side" ? { sideOpen: open } : { rightOpen: open });
            if (open) s.setPanelWidth(panel, raw);
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            document.body.style.cursor = "";
        };
        document.body.style.cursor = "col-resize";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    };

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={side === "left" ? "Resize side panel" : "Resize right panel"}
            onPointerDown={onPointerDown}
            className={`absolute inset-y-0 z-10 hidden w-1.5 cursor-col-resize touch-none transition-colors hover:bg-accent/40 active:bg-accent/60 ${side === "left" ? "right-0 md:block" : "left-0 lg:block"}`}
        />
    );
}
