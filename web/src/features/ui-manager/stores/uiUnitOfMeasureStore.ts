import { create } from "zustand";
import { getUiPreference, setUiPreference } from "@/data/local/uiPreferences";
import { DEFAULT_UNIT_OF_MEASURE, type UnitOfMeasure } from "@/utils/unitOfMeasure";

const UI_PREF_KEY = "ui.unitOfMeasure";

interface UiUnitOfMeasureState {
    unitOfMeasure: UnitOfMeasure;
    initialized: boolean;
    initialize: () => Promise<void>;
    setUnitOfMeasure: (unit: UnitOfMeasure) => Promise<void>;
}

export const useUiUnitOfMeasureStore = create<UiUnitOfMeasureState>()((set, get) => ({
    unitOfMeasure: DEFAULT_UNIT_OF_MEASURE,
    initialized: false,

    initialize: async () => {
        if (get().initialized) return;

        const saved = await getUiPreference<UnitOfMeasure>(UI_PREF_KEY, DEFAULT_UNIT_OF_MEASURE);
        const resolved: UnitOfMeasure =
            saved === "none" || saved === "cm" || saved === "m" || saved === "km"
                ? saved
                : DEFAULT_UNIT_OF_MEASURE;

        set({ unitOfMeasure: resolved, initialized: true });
    },

    setUnitOfMeasure: async (unit) => {
        set({ unitOfMeasure: unit });
        await setUiPreference(UI_PREF_KEY, unit);
    },
}));
