import { Tab, TabList } from "@headlessui/react";

interface InspectorPanelTabBarProps {
    tabs: { id: string; label: string }[];
}

/** The tab buttons; render inside a Headless UI TabGroup, which holds the selection. */
export default function InspectorPanelTabBar({ tabs }: InspectorPanelTabBarProps) {
    return (
        <TabList className="flex shrink-0 gap-1 px-3 pt-1">
            {tabs.map((tab) => (
                <Tab
                    key={tab.id}
                    className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:text-fg data-selected:bg-hover data-selected:font-medium data-selected:text-fg"
                >
                    {tab.label}
                </Tab>
            ))}
        </TabList>
    );
}
