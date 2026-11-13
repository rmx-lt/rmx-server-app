import { create } from "zustand";
import { persist } from "zustand/middleware";

export type InspectorTab = "details" | "layers";

interface InspectorTabState {
    activeTab: InspectorTab;
    setActiveTab: (tab: InspectorTab) => void;
}

export const useInspectorTabStore = create<InspectorTabState>()(
    persist(
        (set) => ({
            activeTab: "details",
            setActiveTab: (tab) => set({ activeTab: tab }),
        }),
        { name: "inspector-tab" }
    )
);
