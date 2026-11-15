import { Info } from "lucide-react";
import { forwardRef } from "react";

interface SettingsPanelRowProps extends React.HTMLAttributes<HTMLDivElement> {
    label: string;
    /** When provided, renders a small info icon with a native tooltip after the label. */
    tooltip?: string;
    children: React.ReactNode;
}

const SettingsPanelRow = forwardRef<HTMLDivElement, SettingsPanelRowProps>(
    ({ label, tooltip, children, ...rest }, ref) => (
        <div ref={ref} {...rest} className="flex min-h-11 items-center gap-3 py-1">
            <span className="flex w-2/5 shrink-0 items-center gap-1 truncate text-sm text-fg select-none">
                <span className="truncate">{label}</span>
                {tooltip && (
                    <span title={tooltip} className="shrink-0 cursor-default text-faint">
                        <Info size={13} aria-label={tooltip} />
                    </span>
                )}
            </span>
            {children}
        </div>
    ),
);

SettingsPanelRow.displayName = "SettingsPanelRow";

export default SettingsPanelRow;
