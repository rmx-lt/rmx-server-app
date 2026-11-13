import type { MouseEvent } from "react";
import type { CardModalListPartColumn } from "@/components/modals/card-modal/CardModalListPart.types";
import { toTitleCase } from "./presentation";

interface InternalCardModalListPartHeaderProps {
    gridTemplateColumns: string;
    mainColumn: CardModalListPartColumn;
    dataColumns: CardModalListPartColumn[];
    resizingColumnId: string | null;
    onResizeStart: (event: MouseEvent, columnId: string) => void;
}

function InternalCardModalListPartHeaderCell({
    column,
    isLast = false,
    resizingColumnId,
    onResizeStart,
}: {
    column: CardModalListPartColumn;
    isLast?: boolean;
    resizingColumnId: string | null;
    onResizeStart: (event: MouseEvent, columnId: string) => void;
}) {
    return (
        <div className={`relative px-3 py-2 border-r border-gray-200 ${isLast ? "last:border-r-0" : ""}`.trim()}>
            <div className="flex items-center justify-start min-w-0 text-[11px] font-semibold tracking-wide text-gray-500 text-left">
                <span className="truncate">{typeof column.title === "string" ? toTitleCase(column.title) : column.title}</span>
            </div>
            <button
                type="button"
                aria-label={`Resize ${typeof column.title === "string" ? column.title : column.id} column`}
                onMouseDown={(event) => onResizeStart(event, column.id)}
                className={`absolute right-0 top-0 bottom-0 w-1 translate-x-1/2 cursor-col-resize transition-colors ${resizingColumnId === column.id ? "bg-teal-600" : "bg-transparent hover:bg-teal-500"}`}
            />
        </div>
    );
}

export default function InternalCardModalListPartHeader({
    gridTemplateColumns,
    mainColumn,
    dataColumns,
    resizingColumnId,
    onResizeStart,
}: InternalCardModalListPartHeaderProps) {
    return (
        <div className="sticky top-0 z-10 overflow-hidden border-b border-gray-200 bg-gray-100">
            <div className="grid w-full items-stretch" style={{ gridTemplateColumns }}>
                <div className="px-2 py-2 border-r border-gray-200" />
                <InternalCardModalListPartHeaderCell
                    column={mainColumn}
                    resizingColumnId={resizingColumnId}
                    onResizeStart={onResizeStart}
                />
                <div className="px-2 py-2 border-r border-gray-200" />
                {dataColumns.map((column) => (
                    <InternalCardModalListPartHeaderCell
                        key={column.id}
                        column={column}
                        isLast
                        resizingColumnId={resizingColumnId}
                        onResizeStart={onResizeStart}
                    />
                ))}
            </div>
        </div>
    );
}
