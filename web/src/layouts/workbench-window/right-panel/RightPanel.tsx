import { TabGroup, TabPanel, TabPanels } from "@headlessui/react";
import { ChartLine, X } from "lucide-react";
import InspectorPanelSection from "@/components/inspector-panel/InspectorPanelSection";
import InspectorPanelTabBar from "@/components/inspector-panel/InspectorPanelTabBar";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import CategoryField from "@/features/inspector/components/object-section/CategoryField";
import GrossAreaField from "@/features/inspector/components/object-section/GrossAreaField";
import NetAreaField from "@/features/inspector/components/object-section/NetAreaField";
import MowingAreaField from "@/features/inspector/components/map-section/MowingAreaField";
import MowingAreaCountField from "@/features/inspector/components/map-section/MowingAreaCountField";
import NoGoAreaCountField from "@/features/inspector/components/map-section/NoGoAreaCountField";
import PerimeterLengthField from "@/features/inspector/components/map-section/PerimeterLengthField";
import { useMapStore } from "@/model/mapStore";
import { useUiShellStore, type RightTab } from "@/features/ui-manager/stores/uiShellStore";

const TABS: { id: RightTab; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "monitor", label: "Monitor" },
];

/** What matters for mowing: the active zone's totals, or the selected area. No vertex data. */
function Details() {
    const hasSelection = useCanvasSelectionStore((s) => s.selectedObject !== null);
    const zoneName = useMapStore((s) => s.zones.find((z) => z.id === s.activeZoneId)?.name ?? "Zone");
    return (
        <>
            <InspectorPanelSection title={zoneName}>
                <MowingAreaCountField />
                <NoGoAreaCountField />
                <MowingAreaField />
                <PerimeterLengthField />
            </InspectorPanelSection>
            {hasSelection && (
                <InspectorPanelSection title="Selected area">
                    <CategoryField />
                    <GrossAreaField />
                    <NetAreaField />
                </InspectorPanelSection>
            )}
        </>
    );
}

/** Placeholder: charts and metrics chosen by the user come with rmx-server-app#93. */
function Monitor() {
    return (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted">
            <ChartLine size={28} strokeWidth={1.5} className="text-faint" aria-hidden />
            <p>Charts and metrics of the mower appear here once it is connected.</p>
        </div>
    );
}

/** Right panel with the tabs Details and Monitor. */
export default function RightPanel() {
    const rightOpen = useUiShellStore((s) => s.rightOpen);
    const setRightOpen = useUiShellStore((s) => s.toggleRight);
    const tab = useUiShellStore((s) => s.rightTab);
    const setTab = useUiShellStore((s) => s.setRightTab);

    if (!rightOpen) return null;

    return (
        <>
            <div aria-hidden className="fixed inset-0 z-30 bg-overlay lg:hidden" onClick={setRightOpen} />
            <aside
                aria-label="Right panel"
                className="fixed inset-y-0 right-0 z-40 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-l border-line bg-surface pt-12 lg:static lg:z-auto lg:max-w-none lg:pt-2"
            >
                <button
                    type="button"
                    aria-label="Close right panel"
                    onClick={setRightOpen}
                    className="absolute top-2 right-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg lg:hidden"
                >
                    <X size={18} strokeWidth={1.75} />
                </button>
                <TabGroup selectedIndex={TABS.findIndex((t) => t.id === tab)} onChange={(i) => setTab(TABS[i]!.id)}>
                    <InspectorPanelTabBar tabs={TABS} />
                    <TabPanels className="pb-4">
                        <TabPanel>
                            <Details />
                        </TabPanel>
                        <TabPanel>
                            <Monitor />
                        </TabPanel>
                    </TabPanels>
                </TabGroup>
            </aside>
        </>
    );
}
