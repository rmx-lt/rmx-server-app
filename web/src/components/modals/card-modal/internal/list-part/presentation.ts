import type { CardModalListPartCell } from "@/components/modals/card-modal/CardModalListPart.types";

export const SELECTION_COLUMN_WIDTH = 36;
export const ACTIONS_COLUMN_WIDTH = 44;
export const ROW_INDENT_STEP = 18;

export function toTitleCase(value: string) {
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getToneClassName(tone: CardModalListPartCell["tone"] = "default") {
    switch (tone) {
        case "muted":
            return "text-faint";
        case "subtle":
            return "text-faint";
        default:
            return "text-fg";
    }
}
