interface SettingsPanelSeparatorProps {
    label: string;
}

export default function SettingsPanelSeparator({ label }: SettingsPanelSeparatorProps) {
    return (
        <div className="flex items-center gap-2 px-3 py-1 mt-0.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider select-none whitespace-nowrap">
                {label}
            </span>
            <div className="flex-1 h-px bg-gray-200" />
        </div>
    );
}
