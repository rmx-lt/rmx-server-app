import { create } from "zustand";

const BASE_Z = 20;

interface FloatingControlZState {
    order: string[]; // back → front
    register: (id: string) => void;
    bringToFront: (id: string) => void;
    getZIndex: (id: string) => number;
}

export const useFloatingControlZStore = create<FloatingControlZState>((set, get) => ({
    order: [],

    register: (id) => {
        set((s) => {
            if (s.order.includes(id)) return s;
            return { order: [...s.order, id] };
        });
    },

    bringToFront: (id) => {
        set((s) => {
            if (s.order[s.order.length - 1] === id) return s;
            return { order: [...s.order.filter((x) => x !== id), id] };
        });
    },

    getZIndex: (id) => {
        const { order } = get();
        const idx = order.indexOf(id);
        return BASE_Z + (idx === -1 ? 0 : idx);
    },
}));
