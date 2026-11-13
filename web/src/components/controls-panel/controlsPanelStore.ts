import { create } from "zustand";
import type { ControlsPanelState, ControlsPanelSectionId } from "@/components/controls-panel/controlsPanelTypes";

export const useControlsPanelStore = create<ControlsPanelState>((set) => ({
    expandedSections: {
        general: true,
        algo: true,
        env: true,
        object: true,
        "computation-provider": true,
        debug: false,
    },

    toggleSection: (sectionId: ControlsPanelSectionId) =>
        set((state) => ({
            expandedSections: {
                ...state.expandedSections,
                [sectionId]: !(state.expandedSections[sectionId] ?? true),
            },
        })),

    expandSection: (sectionId: ControlsPanelSectionId) =>
        set((state) => ({
            expandedSections: {
                ...state.expandedSections,
                [sectionId]: true,
            },
        })),

    collapseSection: (sectionId: ControlsPanelSectionId) =>
        set((state) => ({
            expandedSections: {
                ...state.expandedSections,
                [sectionId]: false,
            },
        })),
}));
