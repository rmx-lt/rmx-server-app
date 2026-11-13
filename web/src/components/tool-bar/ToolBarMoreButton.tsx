import { useEffect, useRef, useState } from "react";
import ToolBarButton from "./ToolBarButton";

export interface OverflowItem {
    id: string;
    icon: string;
    label: string;
    onClick: () => void;
    isDisabled?: boolean;
    isActive?: boolean;
}

export interface OverflowGroup {
    id: string;
    overflowItems: OverflowItem[];
}

interface Props {
    groups: OverflowGroup[];
}

export default function ToolBarMoreButton({ groups }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        const onMouseDown = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [isOpen]);

    return (
        <div ref={containerRef} className="relative">
            <ToolBarButton
                title="More"
                icon="more_horiz"
                isActive={isOpen}
                onClick={() => setIsOpen((prev) => !prev)}
            />

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-max rounded border border-gray-300 bg-white shadow-lg py-1">
                    {groups.map((group, groupIdx) => (
                        <div key={group.id}>
                            {groupIdx > 0 && (
                                <hr className="my-1 border-gray-200" />
                            )}
                            {group.overflowItems.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    disabled={item.isDisabled}
                                    onClick={() => {
                                        item.onClick();
                                        setIsOpen(false);
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                                >
                                    <span
                                        className={`material-symbols-outlined text-base leading-none${item.isActive ? " text-teal-700" : ""}`}
                                    >
                                        {item.icon}
                                    </span>
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
