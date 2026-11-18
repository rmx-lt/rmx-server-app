import { Info } from "lucide-react";
import { forwardRef } from "react";
import Tooltip from "@/components/tooltip/Tooltip";

interface SettingsPanelRowProps extends React.HTMLAttributes<HTMLDivElement> {
    label: string;
    /** When provided, renders a small info icon with a tooltip after the label. */
    tooltip?: string;
    children: React.ReactNode;
}

const SettingsPanelRow = forwardRef<HTMLDivElement, SettingsPanelRowProps>(
    ({ label, tooltip, children, ...rest }, ref) => (
        <div ref={ref} {...rest} className="flex min-h-11 items-center gap-3 py-1">
            <span className="flex w-2/5 shrink-0 items-center gap-1 truncate text-sm text-fg">
                <span className="truncate">{label}</span>
                {tooltip && (
                    <Tooltip label={tooltip}>
                        <button type="button" aria-label="More information" className="shrink-0 cursor-default rounded text-faint">
                            <Info size={13} aria-hidden />
                        </button>
                    </Tooltip>
                )}
            </span>
            {children}
        </div>
    ),
);

SettingsPanelRow.displayName = "SettingsPanelRow";

export default SettingsPanelRow;
