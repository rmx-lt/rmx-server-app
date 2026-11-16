import { create } from "zustand";
import {
    ZOOM_MIN,
    ZOOM_MAX,
    ZOOM_BUTTON_FACTOR,
    ZOOM_ANIMATION_MS,
} from "@/config/canvas-editing/canvasConfig";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";

interface CanvasViewState {
    position: Point;
    scale: number;
    canvasSize: { width: number; height: number };
    setPosition: (position: Point) => void;
    setScale: (scale: number) => void;
    setCanvasSize: (width: number, height: number) => void;
    /** Animates the scale by `factor`, keeping the screen point `anchor` (default: canvas centre) fixed. A step during an animation moves the target on. */
    zoomBy: (factor: number, anchor?: Point) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    resetView: () => void;
}

const clamp = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

// The running zoom animation; any direct change of the view cancels it.
let anim: { target: number; anchor: Point; world: Point; raf: number; last: number } | null = null;

function cancelAnim() {
    if (anim) cancelAnimationFrame(anim.raf);
    anim = null;
}

export const useCanvasViewStore = create<CanvasViewState>((set, get) => {
    const frame = (now: number) => {
        if (!anim) return;
        const { scale } = get();
        const k = 1 - Math.exp(-(now - anim.last) / ZOOM_ANIMATION_MS);
        anim.last = now;
        const done = Math.abs(Math.log(anim.target / scale)) < 0.001;
        // Geometric easing: equal steps in zoom feel equal at every scale.
        const next = done ? anim.target : scale * Math.pow(anim.target / scale, k);
        set({
            scale: next,
            position: { x: anim.anchor.x - anim.world.x * next, y: anim.anchor.y - anim.world.y * next },
        });
        if (done) anim = null;
        else anim.raf = requestAnimationFrame(frame);
    };

    return {
        position: { x: 0, y: 0 },
        scale: 1,
        canvasSize: { width: 0, height: 0 },

        setPosition: (position) => {
            cancelAnim();
            set({ position });
        },

        setCanvasSize: (width, height) => set({ canvasSize: { width, height } }),

        setScale: (scale) => {
            cancelAnim();
            set({ scale: clamp(scale) });
        },

        zoomBy: (factor, anchor) => {
            const { scale, position, canvasSize } = get();
            const target = clamp((anim?.target ?? scale) * factor);
            const a = anchor ?? { x: canvasSize.width / 2, y: canvasSize.height / 2 };
            const world = { x: (a.x - position.x) / scale, y: (a.y - position.y) / scale };
            if (anim) cancelAnimationFrame(anim.raf);
            anim = { target, anchor: a, world, raf: 0, last: performance.now() };
            anim.raf = requestAnimationFrame(frame);
        },

        zoomIn: () => get().zoomBy(ZOOM_BUTTON_FACTOR),
        zoomOut: () => get().zoomBy(1 / ZOOM_BUTTON_FACTOR),

        resetView: () => {
            cancelAnim();
            const { canvasSize } = get();
            set({
                position: { x: canvasSize.width / 2, y: canvasSize.height / 2 },
                scale: 1,
            });
        },
    };
});
