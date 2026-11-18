import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { LogOut, Settings } from "lucide-react";
import Tooltip from "@/components/tooltip/Tooltip";
import { logout } from "@/features/auth/data/session";
import { useAuthStore } from "@/features/auth/stores/authStore";
import { useUiShellStore } from "@/features/ui-manager/stores/uiShellStore";

/** A row of a side panel (button look). */
export const panelRow = "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors";
const menuItem = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg data-focus:bg-hover";

/** The account menu and the settings button, at the bottom of both side panels. */
export default function Account() {
    const username = useAuthStore((s) => s.username) ?? "";
    const openSettings = useUiShellStore((s) => s.openSettings);
    return (
        <div className="flex items-center gap-1">
            <Menu>
                <MenuButton className={`${panelRow} h-11 min-w-0 flex-1 text-fg hover:bg-hover data-open:bg-hover`}>
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
            <Tooltip label="Settings">
                <button
                    type="button"
                    aria-label="Settings"
                    onClick={() => openSettings()}
                    className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
                >
                    <Settings size={18} strokeWidth={1.75} />
                </button>
            </Tooltip>
        </div>
    );
}
