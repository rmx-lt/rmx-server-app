/** Item contract for polygon layers. Each item renders as a filled polygon. */
export interface CanvasPolygonItem {
    id: number;
    /** Polygon vertices in draw order. */
    vertices: { x: number; y: number }[];
    /** Optional centroid used for ID label placement. Falls back to the first vertex if absent. */
    centroidPoint?: { x: number; y: number };
}
