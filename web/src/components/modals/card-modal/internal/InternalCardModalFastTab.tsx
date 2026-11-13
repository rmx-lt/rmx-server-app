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
        <div className="flex shrink-0 flex-col min-h-0 border border-gray-200 rounded overflow-hidden">
            <button
                type="button"
                onClick={onToggle}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide transition-colors cursor-pointer ${disabled ? "bg-gray-100 hover:bg-gray-200" : "bg-gray-50 hover:bg-gray-100"}`}
            >
                <span className="material-symbols-outlined text-gray-400" style={{ fontSize: 16 }}>
                    {expanded ? "expand_more" : "chevron_right"}
                </span>
                {title}
            </button>
            {expanded && (
                <div className={`px-4 py-3 flex flex-col gap-3 min-h-0 ${disabled ? "bg-gray-50" : "bg-white"}`}>
                    {children}
                </div>
            )}
        </div>
    );
}