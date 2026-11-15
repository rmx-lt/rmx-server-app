/**
 * Canvas Generator UI Preferences
 */

export interface CanvasGeneratorFloatingControlPrefs {
    isOpen: boolean;
    position: { x: number; y: number };
    values: {
        width: string;
        height: string;
        cellSize: string;
        /** The no-go zone ratio; the stored name predates the rename to no-go zones. */
        obstacleRatio: string;
        clusteringProb: string;
        seed: string;
        lastSeedHex: string | null;
    };
}
