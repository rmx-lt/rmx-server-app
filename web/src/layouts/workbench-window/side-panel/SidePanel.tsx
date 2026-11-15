import { Menu, MenuButton, MenuItem, MenuItems, Radio, RadioGroup } from "@headlessui/react";
import { Bot, Gamepad2, LogOut, PanelLeftClose, PenTool, Settings, Sprout, SquarePen } from "lucide-react";
import type { ComponentType } from "react";
import AppHeaderLogoBox from "@/components/app-header/AppHeaderLogoBox";
import { MODES, type Mode } from "@/config/modes/modes";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { logout } from "@/features/auth/data/session";
import { useAuthStore } from "@/features/auth/stores/authStore";
import MapList from "@/features/map-manager/components/MapList";
import { newMap } from "@/features/map-manager/data/mapBridge";
import { useUiShellStore } from "@/features/ui-manager/stores/uiShellStore";
import { useModeStore } from "@/model/modeStore";

const MODE_ICON: Record<Mode, ComponentType<{ size?: number; strokeWidth?: number }>> = {
    plan: PenTool,
    drive: Gamepad2,
    mow: Sprout,
};

const row = "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors";
const menuItem = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg data-focus:bg-hover";

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
        <div className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-muted" title="The mower appears here once it is connected (rmx-server-app#93)">
            <Bot size={16} strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Mower</span>
            <span className="text-xs text-faint">Not connected</span>
        </div>
    );
}

function Account() {
    const username = useAuthStore((s) => s.username) ?? "";
    const openSettings = useUiShellStore((s) => s.openSettings);
    return (
        <div className="flex items-center gap-1">
            <Menu>
                <MenuButton className={`${row} min-w-0 flex-1 text-fg hover:bg-hover data-open:bg-hover`}>
                    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold uppercase text-on-accent">
                        {username.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{username}</span>
                    <span className="sr-only">Account menu</span>
                </MenuButton>
                <MenuItems anchor="top start" className="z-50 w-56 rounded-xl border border-line bg-surface p-1 shadow-lg outline-none [--anchor-gap:4px]">
                    <MenuItem>
                        <button type="button" className={menuItem} onClick={() => openSettings("account")}>
                            <Settings size={15} strokeWidth={1.75} /> Settings
                        </button>
                    </MenuItem>
                    <MenuItem>
                        <button type="button" className={menuItem} onClick={() => void logout(false)}>
                            <LogOut size={15} strokeWidth={1.75} /> Log out
                        </button>
                    </MenuItem>
                </MenuItems>
            </Menu>
            <button
                type="button"
                aria-label="Settings"
                title="Settings"
                onClick={() => openSettings()}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
            >
                <Settings size={18} strokeWidth={1.75} />
            </button>
        </div>
    );
}

/** Left panel: logo and name, actions and mode, the map list, the device spot, account and settings. */
export default function SidePanel() {
    const sideOpen = useUiShellStore((s) => s.sideOpen);
    const setSideOpen = useUiShellStore((s) => s.setSideOpen);
    const toggleSide = useUiShellStore((s) => s.toggleSide);

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
                    <button
                        type="button"
                        aria-label="Close side panel"
                        title={`Close side panel (${S["controls.toggle"].shortcut.join("+")})`}
                        onClick={toggleSide}
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
                    >
                        <PanelLeftClose size={18} strokeWidth={1.75} />
                    </button>
                </div>

                <button
                    type="button"
                    onClick={() => newMap().catch(console.error)}
                    title={`New map (${S["map.new"].shortcut.join("+")})`}
                    className={`${row} font-medium text-fg hover:bg-hover`}
                >
                    <SquarePen size={16} strokeWidth={1.75} aria-hidden /> New map
                </button>

                <ModeSwitch />

                <div className="flex min-h-0 flex-1 flex-col">
                    <h2 className="px-2.5 pb-1 text-xs font-medium text-faint">Maps</h2>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <MapList />
                    </div>
                </div>

                <div className="flex flex-col gap-1 border-t border-line pt-2">
                    <DeviceSpot />
                    <Account />
                </div>
            </aside>
        </>
    );
}
