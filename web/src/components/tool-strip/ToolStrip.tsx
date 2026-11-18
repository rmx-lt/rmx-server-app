import type { ComponentType, ReactNode } from "react";
import Tooltip from "@/components/tooltip/Tooltip";

/** A rounded strip of tools that floats over the canvas, bottom middle. */
export function ToolStrip({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div
            role="toolbar"
            aria-label={label}
            className="pointer-events-auto absolute bottom-4 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-2xl border border-line bg-surface p-1.5 shadow-lg"
        >
            {children}
        </div>
    );
}

export function ToolStripSeparator() {
    return <div role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 bg-line" />;
}

interface ToolStripButtonProps {
    label: string;
    icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
    /** The shortcut, from the shortcut definitions; shown in the tooltip. */
    shortcut?: readonly string[];
    /** What the tool does, when it is not there yet; shown after the label. */
    note?: string;
    active?: boolean;
    /** The tool deletes: red. */
    danger?: boolean;
    disabled?: boolean;
    /** The tool is a placeholder: it stays in the Tab order and says what it will do. */
    inert?: boolean;
    onClick?: () => void;
}

export function ToolStripButton({ label, icon: Icon, shortcut, note, active, danger, disabled, inert, onClick }: ToolStripButtonProps) {
    const off = disabled || inert;
    return (
        <Tooltip label={note ? `${label}: ${note}` : label} shortcut={shortcut}>
        <button
            type="button"
            aria-label={label}
            aria-pressed={active === undefined ? undefined : active}
            aria-disabled={off || undefined}
            onClick={off ? undefined : onClick}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                off
                    ? "cursor-not-allowed text-faint"
                    : active
                      ? `cursor-pointer border ${danger ? "border-danger bg-danger-soft text-danger" : "border-accent bg-accent/15 text-accent"}`
                      : `cursor-pointer hover:bg-hover ${danger ? "text-danger" : "text-fg"}`
            }`}
        >
            <Icon size={18} strokeWidth={1.75} aria-hidden />
        </button>
        </Tooltip>
    );
}
