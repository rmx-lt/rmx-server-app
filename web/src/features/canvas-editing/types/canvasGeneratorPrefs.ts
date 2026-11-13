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
        obstacleRatio: string;
        clusteringProb: string;
        seed: string;
        lastSeedHex: string | null;
    };
}
