import { createPortal } from "react-dom";
import type { ListModalAction, ListModalItem } from "../ListModal";

interface InternalListModalRepeaterProps {
    items: ListModalItem[];
    selectedId?: number | null;
    activeId?: number | null;
    onSelect?: (id: number) => void;
    onDoubleClick?: (id: number) => void;
    doubleClickLabel: string;
    actions: ListModalAction[];
    emptyMessage: string;
    isLoading: boolean;
    loadingMessage: string;
    openMenuId: number | null;
    menuPos: { top: number; left: number } | null;
    onMoreClick: (e: React.MouseEvent<HTMLButtonElement>, itemId: number) => void;
    onCloseMenu: () => void;
}

export default function InternalListModalRepeater({
    items,
    selectedId,
    activeId,
    onSelect,
    onDoubleClick,
    doubleClickLabel,
    actions,
    emptyMessage,
    isLoading,
    loadingMessage,
    openMenuId,
    menuPos,
    onMoreClick,
    onCloseMenu,
}: InternalListModalRepeaterProps) {
    const hasActions = actions.length > 0 || !!onDoubleClick;

    return (
        <div className="flex flex-col mx-4">
            {isLoading ? (
                <div className="border border-gray-300 bg-white h-52 rounded flex items-center justify-center text-sm text-gray-400 italic">
                    {loadingMessage}
                </div>
            ) : (
                <>
                    <ul className="border border-gray-300 bg-white h-52 overflow-y-auto rounded">
                        <li className="sticky top-0 flex items-center px-3 py-1 bg-gray-200 text-sm font-bold text-gray-700 tracking-wider border-b border-gray-300 z-10 cursor-default">
                            <span className="flex-1">Name</span>
                            {hasActions && <span className="w-6" />}
                            <span className="w-10 text-right">ID</span>
                        </li>

                        {items.length === 0 ? (
                            <li className="px-3 py-2 text-sm text-gray-400 italic">{emptyMessage}</li>
                        ) : (
                            items.map((item) => {
                                const isSelected = item.id === selectedId;
                                const isActive = item.id === activeId;
                                const isMenuOpen = openMenuId === item.id;

                                return (
                                    <li key={item.id} className={`group flex items-stretch ${isSelected ? "bg-teal-600" : "hover:bg-gray-100"}`}>
                                        <button
                                            type="button"
                                            className={`flex-1 flex items-center pl-3 py-1.5 text-sm text-left cursor-pointer ${isSelected ? "text-white" : "text-gray-700"} ${isActive ? "font-medium" : ""}`}
                                            onClick={(e) => { e.stopPropagation(); onSelect?.(item.id); }}
                                            onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(item.id); }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                        >
                                            <span className="flex-1 truncate min-w-0">
                                                <span
                                                    className={onDoubleClick ? "hover:underline cursor-pointer" : ""}
                                                    title={onDoubleClick ? doubleClickLabel : onSelect ? "Select" : undefined}
                                                    onClick={onDoubleClick ? (e) => { e.stopPropagation(); onDoubleClick(item.id); } : undefined}
                                                >
                                                    {item.name || <span className="italic text-gray-400">Unnamed</span>}
                                                </span>
                                            </span>
                                        </button>
                                        {hasActions && (
                                            <button
                                                type="button"
                                                className={`w-6 flex items-center justify-center rounded transition-opacity cursor-pointer ${isSelected ? "text-white bg-teal-700" : "text-gray-600 bg-gray-200"} ${isMenuOpen ? "opacity-100" : isSelected ? "text-teal-100 bg-transparent hover:text-white hover:bg-teal-700" : "text-gray-400 bg-transparent hover:text-gray-600 hover:bg-gray-200"} ${isSelected || isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                                onClick={(e) => onMoreClick(e, item.id)}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                title="Actions"
                                            >
                                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>more_vert</span>
                                            </button>
                                        )}
                                        <span className={`w-10 pr-3 flex items-center justify-end text-sm tabular-nums shrink-0 ${isSelected ? "text-white" : "text-gray-700"}`}>
                                            {item.id}
                                        </span>
                                    </li>
                                );
                            })
                        )}
                    </ul>

                    {openMenuId !== null && menuPos && createPortal(
                        <>
                            <div
                                className="fixed inset-0 z-55"
                                onMouseDown={(e) => { e.stopPropagation(); onCloseMenu(); }}
                            />
                            <div
                                style={{ top: menuPos.top, left: menuPos.left }}
                                className="fixed z-58 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-36"
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                {onDoubleClick && (
                                    <button
                                        type="button"
                                        className="flex items-center gap-2 w-full px-3 py-1 text-sm text-left text-gray-700 cursor-pointer transition-colors hover:bg-gray-100"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDoubleClick(openMenuId);
                                            onCloseMenu();
                                        }}
                                    >
                                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
                                        {doubleClickLabel}
                                    </button>
                                )}
                                {actions.map((action) => (
                                    <button
                                        key={action.title}
                                        type="button"
                                        className={`flex items-center gap-2 w-full px-3 py-1 text-sm text-left cursor-pointer transition-colors hover:bg-gray-100 ${action.variant === "danger" ? "text-red-600" : "text-gray-700"}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            action.onClick(openMenuId);
                                            onCloseMenu();
                                        }}
                                    >
                                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{action.icon}</span>
                                        {action.title}
                                    </button>
                                ))}
                            </div>
                        </>,
                        document.body,
                    )}
                </>
            )}
        </div>
    );
}