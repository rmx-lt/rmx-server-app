export type ActiveTool = "select" | "addZone" | "addObstacle" | "delete" | "addStartPoint" | "addEndPoint" | "addStartEndPoint";

/** Identifies a vertex by its parent object and its position in the embedded vertices array. */
export interface VertexRef {
    objectId: number;
    index: number;
}
