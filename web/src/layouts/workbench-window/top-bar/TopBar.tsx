import { PanelLeftOpen, PanelRight, PanelRightClose } from "lucide-react";
import MapNameField from "@/features/map-manager/components/MapNameField";
import ConnectionIndicator from "@/features/ui-manager/components/ConnectionIndicator";
import { useUiShellStore } from "@/features/ui-manager/stores/uiShellStore";

const iconButton = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg";

/** Slim bar above the canvas: map name in the middle, connection state and panel toggles at the sides. */
export default function TopBar() {
    const sideOpen = useUiShellStore((s) => s.sideOpen);
    const rightOpen = useUiShellStore((s) => s.rightOpen);
    const toggleSide = useUiShellStore((s) => s.toggleSide);
    const toggleRight = useUiShellStore((s) => s.toggleRight);

    return (
        <header className="flex h-12 shrink-0 items-center gap-2 px-3">
            <div className="flex flex-1 basis-0 items-center">
                {!sideOpen && (
                    <button type="button" aria-label="Open side panel" title="Open side panel" onClick={toggleSide} className={iconButton}>
                        <PanelLeftOpen size={18} strokeWidth={1.75} />
                    </button>
                )}
            </div>
            <div className="flex min-w-0 max-w-[60%] justify-center">
                <MapNameField />
            </div>
            <div className="flex flex-1 basis-0 items-center justify-end gap-1">
                <ConnectionIndicator />
                <button
                    type="button"
                    aria-label={rightOpen ? "Close right panel" : "Open right panel"}
                    title={rightOpen ? "Close right panel" : "Open right panel"}
                    aria-expanded={rightOpen}
                    onClick={toggleRight}
                    className={iconButton}
                >
                    {rightOpen ? <PanelRightClose size={18} strokeWidth={1.75} /> : <PanelRight size={18} strokeWidth={1.75} />}
                </button>
            </div>
        </header>
    );
}
