import type { ReactNode } from "react";

interface InternalCardModalFastTabProps {
    title: string;
    expanded: boolean;
    onToggle: () => void;
    disabled?: boolean;
    children: ReactNode;
}

export default function InternalCardModalFastTab({
    title,
    expanded,
    onToggle,
    disabled = false,
    children,
}: InternalCardModalFastTabProps) {
    return (
        <div className="flex shrink-0 flex-col min-h-0 border border-line rounded overflow-hidden">
            <button
                type="button"
                onClick={onToggle}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide transition-colors cursor-pointer ${disabled ? "bg-raised hover:bg-hover" : "bg-page hover:bg-raised"}`}
            >
                <span className="material-symbols-outlined text-faint" style={{ fontSize: 16 }}>
                    {expanded ? "expand_more" : "chevron_right"}
                </span>
                {title}
            </button>
            {expanded && (
                <div className={`px-4 py-3 flex flex-col gap-3 min-h-0 ${disabled ? "bg-page" : "bg-surface"}`}>
                    {children}
                </div>
            )}
        </div>
    );
}