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
        <div className="flex shrink-0 border-b border-line-strong bg-raised">
            {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        className={`flex-1 px-3 py-2 text-sm font-medium transition-colors focus:outline-none border-b-2 -mb-px
                            ${isActive
                                ? "border-accent text-accent"
                                : "border-transparent text-muted hover:text-fg hover:border-line-strong"
                            }`}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
