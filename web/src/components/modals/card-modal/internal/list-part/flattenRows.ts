import type { CardModalListPartRow, CardModalListPartRowId } from "@/components/modals/card-modal/CardModalListPart.types";

export interface FlattenedInternalCardModalListPartRow {
    row: CardModalListPartRow;
    depth: number;
    parentIds: CardModalListPartRowId[];
}

export function flattenInternalCardModalListPartRows(
    rows: CardModalListPartRow[],
    depth = 0,
    parentIds: CardModalListPartRowId[] = [],
): FlattenedInternalCardModalListPartRow[] {
    const flattenedRows: FlattenedInternalCardModalListPartRow[] = [];

    for (const row of rows) {
        flattenedRows.push({ row, depth, parentIds });

        if (row.kind === "group" && row.expanded) {
            flattenedRows.push(
                ...flattenInternalCardModalListPartRows(row.children, depth + 1, [...parentIds, row.id]),
            );
        }
    }

    return flattenedRows;
}
