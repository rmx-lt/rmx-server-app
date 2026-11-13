import { type ReactNode, useEffect, useRef, useState } from "react";

interface ModalPopUpTriggerState {
    isOpen: boolean;
    pinned: boolean;
    hovered: boolean;
}

interface ModalPopUpProps {
    trigger: ReactNode | ((state: ModalPopUpTriggerState) => ReactNode);
    children: ReactNode;
    disabled?: boolean;
    openOnHover?: boolean;
    openOnClick?: boolean;
    showNotch?: boolean;
    containerClassName?: string;
    triggerClassName?: string;
    widthClassName?: string;
    offsetClassName?: string;
    panelClassName?: string;
    notchBorderClassName?: string;
    notchFillClassName?: string;
}

export default function ModalPopUp({
    trigger,
    children,
    disabled = false,
    openOnHover = true,
    openOnClick = true,
    showNotch = true,
    containerClassName = "",
    triggerClassName = "contents",
    widthClassName = "w-72",
    offsetClassName = "pt-2",
    panelClassName = "",
    notchBorderClassName = "border-b-gray-300",
    notchFillClassName = "border-b-white",
}: ModalPopUpProps) {
    const [pinned, setPinned] = useState(false);
    const [hovered, setHovered] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const isOpen = !disabled && (hovered || pinned);
    const triggerContent = typeof trigger === "function"
        ? trigger({ isOpen, pinned, hovered })
        : trigger;

    useEffect(() => {
        if (!pinned) return;

        const onMouseDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setPinned(false);
            }
        };

        document.addEventListener("mousedown", onMouseDown);

        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [pinned]);

    return (
        <div
            ref={containerRef}
            className={`relative ${containerClassName}`}
            onMouseEnter={() => {
                if (!disabled && openOnHover) {
                    setHovered(true);
                }
            }}
            onMouseLeave={() => setHovered(false)}
        >
            <div
                className={triggerClassName}
                onClick={(e) => {
                    e.stopPropagation();

                    if (!disabled && openOnClick) {
                        setPinned((prev) => !prev);
                    }
                }}
            >
                {triggerContent}
            </div>

            {isOpen && (
                <div className={`absolute top-full left-1/2 -translate-x-1/2 z-50 ${widthClassName} ${offsetClassName}`}>
                    {showNotch && (
                        <>
                            <div className={`absolute top-0 left-[calc(50%-7px)] w-0 h-0 border-l-[7px] border-r-[7px] border-b-[9px] border-l-transparent border-r-transparent ${notchBorderClassName}`} />
                            <div className={`absolute top-px left-[calc(50%-6px)] w-0 h-0 border-l-[6px] border-r-[6px] border-b-8 border-l-transparent border-r-transparent ${notchFillClassName}`} />
                        </>
                    )}

                    <div className={`max-h-52 flex flex-col rounded border border-gray-300 bg-white shadow-lg text-xs text-gray-700 overflow-hidden ${panelClassName}`}>
                        {children}
                    </div>
                </div>
            )}
        </div>
    );
}
