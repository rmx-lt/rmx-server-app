/**
 * Computes the (dx, dy) offset from a point's center to the text center,
 * given a placement direction and a center-to-center distance.
 *
 * - "inside"          → text center at point center; centered horizontally
 * - "outside-right"   → text left edge at `offset` px right of center; left-aligned
 * - "outside-left"    → text right edge at `offset` px left of center; right-aligned
 * - "outside-bottom"  → text center at `offset` px below center; centered horizontally
 * - "outside-top"     → text center at `offset` px above center; centered horizontally (default)
 *
 * To render the <Text> node using the returned values:
 *   x={dx} y={dy}
 *   width={TEXT_W} height={fontSize * 1.5}
 *   offsetX={offsetX} offsetY={fontSize * 0.75}
 *   align={align} verticalAlign="middle"
 */

/**
 * Fixed text-box width used for all result-layer labels.
 * Large enough that labels of any reasonable length are never clipped by Konva.
 */
export const TEXT_W = 400;

/** offsetX that centers the TEXT_W box on the render position. */
export const TEXT_OX = TEXT_W / 2;

export function textPlacementCenter(
    placement: string,
    offset: number,
): { dx: number; dy: number; align: "left" | "center" | "right"; offsetX: number } {
    switch (placement) {
        // Text left edge starts at `offset` px right of center
        case "outside-right": return { dx: offset, dy: 0, align: "left", offsetX: 0 };
        // Text right edge ends at `offset` px left of center
        case "outside-left": return { dx: -offset, dy: 0, align: "right", offsetX: TEXT_W };
        case "outside-bottom": return { dx: 0, dy: offset, align: "center", offsetX: TEXT_OX };
        case "inside": return { dx: 0, dy: 0, align: "center", offsetX: TEXT_OX };
        case "outside-top":
        default: return { dx: 0, dy: -offset, align: "center", offsetX: TEXT_OX };
    }
}
