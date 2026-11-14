interface Tab {
    id: string;
    label: string;
}

interface InspectorPanelTabBarProps {
    tabs: Tab[];
    activeTab: string;
    onTabChange: (id: string) => void;
}

export default function InspectorPanelTabBar({
    tabs,
    activeTab,
    onTabChange,
}: InspectorPanelTabBarProps) {
    return (
        <div className="flex shrink-0 border-b border-gray-300 bg-gray-100">
            {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        className={`flex-1 px-3 py-2 text-sm font-medium transition-colors focus:outline-none border-b-2 -mb-px
                            ${isActive
                                ? "border-teal-600 text-teal-700"
                                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                            }`}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
