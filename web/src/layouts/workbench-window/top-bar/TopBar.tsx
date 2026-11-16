import { PanelLeftOpen, PanelRight, PanelRightClose } from "lucide-react";
import Tooltip from "@/components/tooltip/Tooltip";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import MapNameField from "@/features/map-manager/components/MapNameField";
import { useUiShellStore } from "@/features/ui-manager/stores/uiShellStore";

const iconButton = "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg";

/** Bar above the canvas and the right panel, full width up to the right edge: map name at the left, panel toggles, a line under it. */
export default function TopBar() {
    const sideOpen = useUiShellStore((s) => s.sideOpen);
    const rightOpen = useUiShellStore((s) => s.rightOpen);
    const toggleSide = useUiShellStore((s) => s.toggleSide);
    const toggleRight = useUiShellStore((s) => s.toggleRight);
    const rightLabel = rightOpen ? "Close right panel" : "Open right panel";

    return (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
            {!sideOpen && (
                <Tooltip label="Open side panel" shortcut={S["controls.toggle"].shortcut}>
                    <button type="button" aria-label="Open side panel" onClick={toggleSide} className={iconButton}>
                        <PanelLeftOpen size={18} strokeWidth={1.75} />
                    </button>
                </Tooltip>
            )}
            <MapNameField />
            <div className="ml-auto flex items-center">
                <Tooltip label={rightLabel} shortcut={S["inspector.toggle"].shortcut}>
                    <button type="button" aria-label={rightLabel} aria-expanded={rightOpen} onClick={toggleRight} className={iconButton}>
                        {rightOpen ? <PanelRightClose size={18} strokeWidth={1.75} /> : <PanelRight size={18} strokeWidth={1.75} />}
                    </button>
                </Tooltip>
            </div>
        </header>
    );
}
