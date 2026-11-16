import { ArrowLeft, Plus, SquarePen } from "lucide-react";
import ConfirmationModal from "@/components/modals/confirmation-modal/ConfirmationModal";
import Tooltip from "@/components/tooltip/Tooltip";
import AppHeaderLogoBox from "@/components/app-header/AppHeaderLogoBox";
import { WORKBENCH_SHORTCUTS as S } from "@/config/shortcut-manager/workbenchShortcutsConfig";
import { useShortcut } from "@/hooks/shortcut-manager/useShortcut";
import MapList from "@/features/map-manager/components/MapList";
import { newMap } from "@/features/map-manager/data/mapBridge";
import Account, { panelRow } from "@/layouts/account/Account";
import BottomBar from "@/layouts/bottom-bar/BottomBar";
import SettingsModal from "@/layouts/workbench-window/settings/SettingsModal";
import { useMapStore } from "@/model/mapStore";
import { usePageStore } from "@/model/pageStore";

const makeMap = () => void newMap().catch(console.error);

function HomeSidePanel() {
    const mapId = useMapStore((s) => s.map.id);
    const mapName = useMapStore((s) => s.map.name);
    const setPage = usePageStore((s) => s.setPage);
    // id 0: no map is open.
    const hasMap = mapId !== 0;
    const back = () => setPage("workbench");

    useShortcut("home.back", S["home.back"].keys, () => hasMap && back());

    return (
        <aside aria-label="Home side panel" className="flex shrink-0 flex-col gap-3 border-b border-line bg-surface p-3 md:w-72 md:border-r md:border-b-0">
            <div className="flex items-center gap-2.5 px-1">
                <AppHeaderLogoBox />
                <span className="flex-1 text-base font-semibold tracking-wide text-fg">RMX</span>
            </div>

            {hasMap && (
                <button type="button" onClick={back} className={`${panelRow} text-fg hover:bg-hover`}>
                    <ArrowLeft size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">Back to {mapName}</span>
                    <kbd className="shrink-0 rounded border border-line-strong px-1.5 py-0.5 font-sans text-xs text-muted">{S["home.back"].shortcut.join("+")}</kbd>
                </button>
            )}
            <Tooltip label="New map" shortcut={S["map.new"].shortcut}>
                <button type="button" onClick={makeMap} className={`${panelRow} font-medium text-fg hover:bg-hover max-md:hidden`}>
                    <SquarePen size={16} strokeWidth={1.75} aria-hidden /> New map
                </button>
            </Tooltip>

            <div className="min-h-0 flex-1 max-md:hidden" />
            <div className="border-t border-line pt-2">
                <Account />
            </div>
        </aside>
    );
}

/** Home: a side panel (back, New map, account) and a work area (the New map card, the list of maps). */
export default function HomeWindow() {
    useShortcut("map.new", S["map.new"].keys, makeMap);
    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-page text-fg">
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <HomeSidePanel />
                <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-10 md:py-12">
                        <h1 className="text-2xl font-semibold">Home</h1>
                        <button
                            type="button"
                            onClick={makeMap}
                            className="mt-6 flex w-full max-w-60 cursor-pointer flex-col items-start gap-6 rounded-2xl border border-dashed border-line-strong p-4 text-left transition-colors hover:bg-hover"
                        >
                            <Plus size={20} strokeWidth={1.75} aria-hidden className="text-accent" />
                            <span className="text-sm font-medium">New map</span>
                        </button>
                        <h2 className="mt-10 mb-2 px-3 text-xs font-medium text-faint">Your maps</h2>
                        <MapList />
                    </div>
                </main>
            </div>
            <BottomBar />
            <SettingsModal />
            <ConfirmationModal />
        </div>
    );
}
