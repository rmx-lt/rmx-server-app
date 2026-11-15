interface SettingsPanelSeparatorProps {
    label: string;
}

export default function SettingsPanelSeparator({ label }: SettingsPanelSeparatorProps) {
    return <h3 className="mt-5 mb-1 border-b border-line pb-1.5 text-xs font-medium text-faint select-none first:mt-0">{label}</h3>;
}
