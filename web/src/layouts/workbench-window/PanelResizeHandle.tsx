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
            cursorLock.remove();
            useUiShellStore.setState({ resizing: null });
        };
        // The cursor stays the resize cursor wherever it goes (also after the panel closed and the strip is gone) until release.
        const cursorLock = document.createElement("style");
        cursorLock.textContent = "* { cursor: col-resize !important; }";
        document.head.append(cursorLock);
        useUiShellStore.setState({ resizing: panel });
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    };

    const panel = side === "left" ? "side" : "right";
    const resizing = useUiShellStore((s) => s.resizing === panel);

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={side === "left" ? "Resize side panel" : "Resize right panel"}
            onPointerDown={onPointerDown}
            className={`group absolute inset-y-0 z-10 hidden w-2 cursor-col-resize touch-none ${side === "left" ? "right-0 md:block" : "left-0 lg:block"}`}
        >
            {/* A thin line on the panel edge; the grab area around it is wider. */}
            <div className={`absolute inset-y-0 w-0.5 bg-accent ${side === "left" ? "right-0" : "left-0"} ${resizing ? "" : "opacity-0 group-hover:opacity-100"}`} />
        </div>
    );
}
