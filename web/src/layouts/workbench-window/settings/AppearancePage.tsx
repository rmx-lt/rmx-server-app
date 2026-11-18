import SettingsPanelSelect from "@/components/settings-panel/SettingsPanelRowSelect";
import SettingsPanelSeparator from "@/components/settings-panel/SettingsPanelSeparator";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { useThemeChoice } from "@/hooks/useTheme";
import { setThemeChoice, type ThemeChoice } from "@/utils/theme";
import type { UnitOfMeasure } from "@/utils/unitOfMeasure";

const THEMES = [
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
];

const UNITS = [
    { value: "none", label: "None (map units)" },
    { value: "cm", label: "Centimetres" },
    { value: "m", label: "Metres" },
    { value: "km", label: "Kilometres" },
];

export default function AppearancePage() {
    const theme = useThemeChoice();
    const unit = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);
    const setUnit = useUiUnitOfMeasureStore((s) => s.setUnitOfMeasure);

    return (
        <>
            <SettingsPanelSeparator label="Theme" />
            <SettingsPanelSelect label="Theme" value={theme} options={THEMES} onChange={(v) => setThemeChoice(v as ThemeChoice)} />
            <SettingsPanelSeparator label="Units" />
            <SettingsPanelSelect
                label="Unit of measure"
                value={unit}
                options={UNITS}
                onChange={(v) => void setUnit(v as UnitOfMeasure).catch(console.error)}
            />
        </>
    );
}
