import { expect, test } from "bun:test";

const queued: FrameRequestCallback[] = [];
Object.assign(globalThis, {
    requestAnimationFrame: (cb: FrameRequestCallback) => queued.push(cb),
    cancelAnimationFrame: (id: number) => void (queued[id - 1] = () => {}),
});

test("a pan stops a running zoom and blocks new zoom and animations until it ends", async () => {
    const { useCanvasViewStore: s } = await import("../canvasViewStore");
    s.getState().zoomBy(2);
    s.getState().setPanning(true);
    queued.forEach((cb) => cb(performance.now() + 1000)); // the stopped animation must not move the view
    expect(s.getState().scale).toBe(1);
    s.getState().zoomBy(2);
    s.getState().animateTo(3, { x: 5, y: 5 });
    expect(queued.length).toBe(1); // nothing new scheduled
    s.getState().setPanning(false);
    s.getState().zoomBy(2);
    expect(queued.length).toBe(2);
});
