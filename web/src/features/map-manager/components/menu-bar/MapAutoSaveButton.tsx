import MenuBarItem from "@/components/menu-bar/MenuBarItem";
import { useSaveModeStore } from "@/model/saveModeStore";
import { applyAutoSaveToggle } from "@/features/map-manager/data/mapBridge";

export default function MapAutoSaveButton() {
    const isAutoSaveEnabled = useSaveModeStore((s) => s.isAutoSaveEnabled);
    const setAutoSaveEnabled = useSaveModeStore((s) => s.setAutoSaveEnabled);

    function handleClick() {
        const next = !isAutoSaveEnabled;
        setAutoSaveEnabled(next);
        applyAutoSaveToggle(next).catch(console.error);
    }

    return (
        <MenuBarItem
            label="Autosave"
            hasCheckmark
            defaultChecked={isAutoSaveEnabled}
            onClick={handleClick}
        />
    );
}
