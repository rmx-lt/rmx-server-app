import { Radio, RadioGroup } from "@headlessui/react";
import { Bot, Gamepad2, House, PanelLeftClose, PenTool, Sprout } from "lucide-react";
import type { ComponentType } from "react";
import AppHeaderLogoBox from "@/components/app-header/AppHeaderLogoBox";
import Tooltip from "@/components/tooltip/Tooltip";
import { MODES, type Mode } from "@/config/modes/modes";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import ZoneList from "@/features/map-manager/components/ZoneList";
import { useUiShellStore } from "@/features/ui-manager/stores/uiShellStore";
import Account, { panelRow } from "@/layouts/account/Account";
import { useModeStore } from "@/model/modeStore";
import { usePageStore } from "@/model/pageStore";

const MODE_ICON: Record<Mode, ComponentType<{ size?: number; strokeWidth?: number }>> = {
    plan: PenTool,
    drive: Gamepad2,
    mow: Sprout,
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

/** Left panel: logo and name, Home, the mode, the device spot, account and settings. The zone list of the open map fills the space between. */
export default function SidePanel() {
    const sideOpen = useUiShellStore((s) => s.sideOpen);
    const setSideOpen = useUiShellStore((s) => s.setSideOpen);
    const toggleSide = useUiShellStore((s) => s.toggleSide);
    const setPage = usePageStore((s) => s.setPage);

    if (!sideOpen) return null;

    return (
        <>
            {/* Under md the panel floats over the canvas; a tap outside closes it. */}
            <div aria-hidden className="fixed inset-0 z-30 bg-overlay md:hidden" onClick={() => setSideOpen(false)} />
            <aside
                aria-label="Side panel"
                className="fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col gap-3 border-r border-line bg-surface p-3 md:static md:z-auto md:max-w-none"
            >
                <div className="flex items-center gap-2.5 px-1">
                    <AppHeaderLogoBox />
                    <span className="flex-1 text-base font-semibold tracking-wide text-fg">RMX</span>
                    <Tooltip label="Close side panel" shortcut={S["controls.toggle"].shortcut}>
                        <button
                            type="button"
                            aria-label="Close side panel"
                            onClick={toggleSide}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
                        >
                            <PanelLeftClose size={18} strokeWidth={1.75} />
                        </button>
                    </Tooltip>
                </div>

                <button type="button" onClick={() => setPage("home")} className={`${panelRow} font-medium text-fg hover:bg-hover`}>
                    <House size={16} strokeWidth={1.75} aria-hidden /> Home
                </button>

                <ModeSwitch />

                <ZoneList />

                <div className="flex flex-col gap-1 border-t border-line pt-2">
                    <DeviceSpot />
                    <Account />
                </div>
            </aside>
        </>
    );
}
