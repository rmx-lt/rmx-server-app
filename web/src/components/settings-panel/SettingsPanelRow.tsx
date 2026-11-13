import { forwardRef } from "react";

interface SettingsPanelRowProps extends React.HTMLAttributes<HTMLDivElement> {
    label: string;
    /** When provided, renders a small info icon with a native tooltip after the label. */
    tooltip?: string;
    children: React.ReactNode;
}

const SettingsPanelRow = forwardRef<HTMLDivElement, SettingsPanelRowProps>(
    ({ label, tooltip, children, ...rest }, ref) => (
        <div ref={ref} {...rest} className="flex items-center gap-3 px-3 h-8">
            <span className="w-[55%] text-xs text-gray-500 shrink-0 truncate select-none flex items-center gap-1">
                <span className="truncate">{label}</span>
                {tooltip && (
                    <span
                        title={tooltip}
                        className="material-symbols-outlined shrink-0 text-gray-400 cursor-default"
                        style={{ fontSize: 12 }}
                    >
                        info
                    </span>
                )}
            </span>
            {children}
        </div>
    ),
);

SettingsPanelRow.displayName = "SettingsPanelRow";

export default SettingsPanelRow;
