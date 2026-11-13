import { create } from "zustand";
import type { Object } from "@/data/local/schemaTypes";
import { useCanvasObjectStore } from "./canvasObjectStore";

// ---------------------------------------------------------------------------
// Snapshot — captures the full canvas state
// ---------------------------------------------------------------------------

interface CanvasSnapshot {
    objects: Object[];
}

// ---------------------------------------------------------------------------
// Dirty-set diff — used when restoring a snapshot so that dirty tracking
// stays accurate relative to the DB after an undo/redo.
// ---------------------------------------------------------------------------

function diffSnapshots(
    from: CanvasSnapshot,
    to: CanvasSnapshot,
): {
    dirtyObjects: Object[];
    deletedObjects: Object[];
} {
    const fromObjectMap = new Map(from.objects.map((o) => [o.id, o]));
    const toObjectIds = new Set(to.objects.map((o) => o.id));

    const dirtyObjects = to.objects.filter((o) => fromObjectMap.get(o.id) !== o);
    const deletedObjects = from.objects.filter((o) => !toObjectIds.has(o.id));

    return { dirtyObjects, deletedObjects };
}

function restoreSnapshot(current: CanvasSnapshot, target: CanvasSnapshot) {
    const dirty = diffSnapshots(current, target);
    useCanvasObjectStore.setState({
        objects: target.objects,
        ...dirty,
    });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface CanvasHistoryState {
    past: CanvasSnapshot[];
    future: CanvasSnapshot[];
    canUndo: boolean;
    canRedo: boolean;
    /** @internal Set while undo/redo is restoring a snapshot to suppress the auto-push subscriber. */
    _isTimeTraveling: boolean;
    /** @internal Set while a batch is open to defer snapshot capture until endBatch(). */
    _isBatching: boolean;
    /** @internal The snapshot captured at beginBatch(). */
    _batchSnapshot: CanvasSnapshot | null;

    /** Restores the previous snapshot and moves current state to redo stack. */
    undo: () => void;
    /** Re-applies the next snapshot from the redo stack. */
    redo: () => void;
    /** Captures a batch-start snapshot. Subsequent store changes are grouped into one history entry. */
    beginBatch: () => void;
    /** Commits the batched changes as a single history entry. No-op if nothing changed. */
    endBatch: () => void;
    /** Clears all undo/redo history. Call after loading or resetting a workspace. */
    resetHistory: () => void;
}

export const useCanvasHistoryStore = create<CanvasHistoryState>()((set, get) => ({
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
    _isTimeTraveling: false,
    _isBatching: false,
    _batchSnapshot: null,

    undo: () => {
        const { past, future } = get();
        if (past.length === 0) return;

        const snapshot = past[past.length - 1]!;
        const current: CanvasSnapshot = {
            objects: useCanvasObjectStore.getState().objects,
        };

        set({ _isTimeTraveling: true });
        restoreSnapshot(current, snapshot);
        set({
            _isTimeTraveling: false,
            past: past.slice(0, -1),
            future: [current, ...future],
            canUndo: past.length - 1 > 0,
            canRedo: true,
        });
    },

    redo: () => {
        const { past, future } = get();
        if (future.length === 0) return;

        const snapshot = future[0]!;
        const current: CanvasSnapshot = {
            objects: useCanvasObjectStore.getState().objects,
        };

        set({ _isTimeTraveling: true });
        restoreSnapshot(current, snapshot);
        set({
            _isTimeTraveling: false,
            past: [...past, current],
            future: future.slice(1),
            canUndo: true,
            canRedo: future.length - 1 > 0,
        });
    },

    beginBatch: () => {
        const { _isBatching } = get();
        if (_isBatching) return;
        const { objects } = useCanvasObjectStore.getState();
        set({ _isBatching: true, _batchSnapshot: { objects } });
    },

    endBatch: () => {
        const { _isBatching, _batchSnapshot } = get();
        if (!_isBatching || !_batchSnapshot) return;

        const { objects } = useCanvasObjectStore.getState();
        const hasChanged = objects !== _batchSnapshot.objects;

        if (!hasChanged) {
            set({ _isBatching: false, _batchSnapshot: null });
            return;
        }

        set((s) => {
            const nextPast = [...s.past, _batchSnapshot!];
            return {
                _isBatching: false,
                _batchSnapshot: null,
                past: nextPast,
                future: [],
                canUndo: nextPast.length > 0,
                canRedo: false,
            };
        });
    },
    resetHistory: () =>
        set({ past: [], future: [], canUndo: false, canRedo: false, _batchSnapshot: null, _isBatching: false }),
}));

// Subscribe to the object store — push a snapshot to past before every change
useCanvasObjectStore.subscribe((next, prev) => {
    if (next.objects === prev.objects) return;
    const { _isTimeTraveling, _isBatching } = useCanvasHistoryStore.getState();
    if (_isTimeTraveling || _isBatching) return;

    const prevSnapshot: CanvasSnapshot = { objects: prev.objects };
    useCanvasHistoryStore.setState((s) => {
        const nextPast = [...s.past, prevSnapshot];
        return { past: nextPast, future: [], canUndo: nextPast.length > 0, canRedo: false };
    });
});

/** Convenience exports for drag hooks. */
export const beginBatch = () => useCanvasHistoryStore.getState().beginBatch();
export const endBatch = () => useCanvasHistoryStore.getState().endBatch();
