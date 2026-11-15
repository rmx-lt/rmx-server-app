import { DialogTitle, Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { MapPin, Palette, User, X } from "lucide-react";
import type { ComponentType } from "react";
import Modal from "@/components/ui/Modal";
import { useUiShellStore, type SettingsPage } from "@/features/ui-manager/stores/uiShellStore";
import AccountPage from "./AccountPage";
import AppearancePage from "./AppearancePage";
import MapDefaultsPage from "./MapDefaultsPage";

// The page list on the left. Later pages (users, NTRIP, devices, shortcuts) come with their own issues.
const PAGES: { id: SettingsPage; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; page: ComponentType }[] = [
    { id: "account", label: "Account", icon: User, page: AccountPage },
    { id: "appearance", label: "Appearance", icon: Palette, page: AppearancePage },
    { id: "map-defaults", label: "Map defaults", icon: MapPin, page: MapDefaultsPage },
];

/** The one settings modal: a page list on the left, the page on the right. */
export default function SettingsModal() {
    const open = useUiShellStore((s) => s.settingsOpen);
    const close = useUiShellStore((s) => s.closeSettings);
    const page = useUiShellStore((s) => s.settingsPage);
    const setPage = useUiShellStore((s) => s.setSettingsPage);

    return (
        <Modal open={open} onClose={close} token="settings-modal" className="h-[34rem] w-full max-w-3xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-2">
                <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
                <button
                    type="button"
                    aria-label="Close settings"
                    title="Close"
                    onClick={close}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
                >
                    <X size={18} strokeWidth={1.75} />
                </button>
            </div>
            <TabGroup
                vertical
                selectedIndex={PAGES.findIndex((p) => p.id === page)}
                onChange={(i) => setPage(PAGES[i]!.id)}
                className="flex min-h-0 flex-1 flex-col sm:flex-row"
            >
                <TabList className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-2 sm:w-48 sm:flex-col sm:overflow-visible sm:pb-0 sm:pl-4 sm:pr-2">
                    {PAGES.map(({ id, label, icon: Icon }) => (
                        <Tab
                            key={id}
                            className="flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:text-fg data-selected:bg-hover data-selected:font-medium data-selected:text-fg"
                        >
                            <Icon size={16} strokeWidth={1.75} />
                            {label}
                        </Tab>
                    ))}
                </TabList>
                <TabPanels className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:pt-1">
                    {PAGES.map(({ id, page: Page }) => (
                        <TabPanel key={id}>
                            <Page />
                        </TabPanel>
                    ))}
                </TabPanels>
            </TabGroup>
        </Modal>
    );
}
