import { Radio, RadioGroup } from "@headlessui/react";
import { Bot, DraftingCompass, House, Navigation, PanelLeft, Play } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import Tooltip from "@/components/tooltip/Tooltip";
import { MODES, type Mode } from "@/config/modes/modes";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import ZoneList from "@/features/map-manager/components/ZoneList";
import { useUiShellStore } from "@/features/ui-manager/stores/uiShellStore";
import Account, { panelRow } from "@/layouts/account/Account";
import PanelResizeHandle from "@/layouts/workbench-window/PanelResizeHandle";
import { useModeStore } from "@/model/modeStore";
import { usePageStore } from "@/model/pageStore";

const MODE_ICON: Record<Mode, ComponentType<{ size?: number; strokeWidth?: number }>> = {
    mow: Play,
    plan: DraftingCompass,
    drive: Navigation,
};

function ModeSwitch() {
    const mode = useModeStore((s) => s.mode);
    const setMode = useModeStore((s) => s.setMode);
    return (
        <RadioGroup value={mode} onChange={setMode} aria-label="Mode" className="grid grid-cols-3 gap-1 rounded-xl bg-page p-1">
            {MODES.map((m) => {
                const Icon = MODE_ICON[m.id];
                return (
                    <Radio
                        key={m.id}
                        value={m.id}
                        className="flex cursor-pointer flex-col items-center gap-0.5 rounded-lg py-1.5 text-xs text-muted transition-colors hover:text-fg data-checked:bg-surface data-checked:font-medium data-checked:text-fg data-checked:shadow-sm"
                    >
                        <Icon size={16} strokeWidth={1.75} />
                        {m.label}
                    </Radio>
                );
            })}
        </RadioGroup>
    );
}

function DeviceSpot() {
    return (
        <Tooltip label="The mower appears here once it is connected">
            <div tabIndex={0} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted">
                <Bot size={16} strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1 truncate">Mower</span>
                <span className="text-xs text-faint">Not connected</span>
            </div>
        </Tooltip>
    );
}

/** Left panel: Home, the mode, the device spot, account and settings. The zone list of the open map fills the space between. */
export default function SidePanel() {
    const sideOpen = useUiShellStore((s) => s.sideOpen);
    const setSideOpen = useUiShellStore((s) => s.setSideOpen);
    const toggleSide = useUiShellStore((s) => s.toggleSide);
    const width = useUiShellStore((s) => s.sideWidth);
    const setPage = usePageStore((s) => s.setPage);

    if (!sideOpen) return null;

    return (
        <>
            {/* Under md the panel floats over the canvas; a tap outside closes it. */}
            <div aria-hidden className="fixed inset-0 z-30 bg-overlay md:hidden" onClick={() => setSideOpen(false)} />
            <aside
                aria-label="Side panel"
                style={{ "--panel-w": `${width}px` } as CSSProperties}
                className="fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface md:relative md:z-auto md:w-(--panel-w) md:max-w-none"
            >
                <PanelResizeHandle side="left" />
                {/* Same place as the open-panel button in the top bar, so the toggle does not move. */}
                <div className="flex h-12 shrink-0 items-center px-3">
                    <Tooltip label="Close side panel" shortcut={S["controls.toggle"].shortcut}>
                        <button
                            type="button"
                            aria-label="Close side panel"
                            onClick={toggleSide}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
                        >
                            <PanelLeft size={18} strokeWidth={1.75} />
                        </button>
                    </Tooltip>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
                <button type="button" onClick={() => setPage("home")} className={`${panelRow} font-medium text-fg hover:bg-hover`}>
                    <House size={16} strokeWidth={1.75} aria-hidden /> Home
                </button>

                <ModeSwitch />

                <ZoneList />

                <div className="-mx-3 flex flex-col gap-1 border-t border-line px-3 pt-2">
                    <DeviceSpot />
                    <Account />
                </div>
                </div>
            </aside>
        </>
    );
}
