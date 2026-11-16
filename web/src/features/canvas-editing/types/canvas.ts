export type ActiveTool = "select" | "addMowingArea" | "addNoGoArea" | "delete";

/** Identifies a vertex by its parent object and its position in the embedded vertices array. */
export interface VertexRef {
    objectId: number;
    index: number;
}
