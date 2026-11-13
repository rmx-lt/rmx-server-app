import { describe, expect, test } from "bun:test";
import {
    computeResolvedClusteringPct,
    computeResolvedObstacleRatioPct,
    generateEnvironment,
    pickWeightedClusteringPriority,
    traceMergedObstaclePolygons,
} from "@/features/canvas-editing/utils/envGenerator";
import { computeActualObstacleRatioPct, computePolygonArea, isPointInPolygon, mulberry32 } from "./testUtils";

function countFreeComponentsFromEnv(
    env: ReturnType<typeof generateEnvironment>,
    cols: number,
    rows: number,
    cellSize: number,
): number {
    const grid = new Uint8Array(cols * rows);

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const point = {
                x: (x + 0.5) * cellSize,
                y: (y + 0.5) * cellSize,
            };

            if (env.obstacles.some((polygon) => isPointInPolygon(point, polygon))) {
                grid[y * cols + x] = 1;
            }
        }
    }

    const visited = new Uint8Array(cols * rows);
    const queue: number[] = [];
    let components = 0;

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const idx = y * cols + x;
            if (grid[idx] === 1 || visited[idx] === 1) continue;

            components += 1;
            visited[idx] = 1;
            queue.length = 0;
            queue.push(idx);

            for (let q = 0; q < queue.length; q++) {
                const cur = queue[q]!;
                const cx = cur % cols;
                const cy = Math.floor(cur / cols);

                const neighbors: Array<[number, number]> = [
                    [cx + 1, cy],
                    [cx - 1, cy],
                    [cx, cy + 1],
                    [cx, cy - 1],
                ];

                for (const [nx, ny] of neighbors) {
                    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                    const nIdx = ny * cols + nx;
                    if (grid[nIdx] === 1 || visited[nIdx] === 1) continue;
                    visited[nIdx] = 1;
                    queue.push(nIdx);
                }
            }
        }
    }

    return components;
}

describe("generateEnvironment - obstacle ratio calibration", () => {
    test("keeps specified and actual obstacle ratio within one cell for 10 random env", () => {
        const rand = mulberry32(0xC0FFEE);

        for (let i = 0; i < 10; i++) {
            const width = 100;
            const height = 100;
            const cellSize = 10;
            const cols = width / cellSize;
            const rows = height / cellSize;
            const obstacleRatio = Math.floor(rand() * 101);
            const clusteringProb = Math.floor(rand() * 101);
            const seed = "";

            const env = generateEnvironment({
                width,
                height,
                cellSize,
                obstacleRatio,
                clusteringProb,
                seed,
            });

            const actualRatio = computeActualObstacleRatioPct(env.boundary, env.obstacles, cellSize, cols, rows);
            const oneCellTolerancePct = 100 / Math.min(cols, rows);

            // The actual measured ratio should match what the generator claims it used,
            // within ±1 cell size tolerance
            expect(Math.abs(actualRatio - env.usedObstacleRatioPct)).toBeLessThanOrEqual(oneCellTolerancePct + 1e-9);
        }
    });
});

describe("resolved random ratios are whole numbers", () => {
    test("auto and range obstacle ratio picks are integers", () => {
        for (let i = 0; i < 100; i++) {
            const seed = `seed-obs-${i}`;
            const auto = computeResolvedObstacleRatioPct(seed);
            const range = computeResolvedObstacleRatioPct(seed, [17, 43]);
            expect(auto).not.toBeNull();
            expect(range).not.toBeNull();
            expect(Number.isInteger(auto!)).toBeTrue();
            expect(Number.isInteger(range!)).toBeTrue();
        }
    });

    test("auto and range clustering picks are integers", () => {
        for (let i = 0; i < 100; i++) {
            const seed = `seed-clust-${i}`;
            const auto = computeResolvedClusteringPct(seed);
            const range = computeResolvedClusteringPct(seed, [8, 72]);
            expect(auto).not.toBeNull();
            expect(range).not.toBeNull();
            expect(Number.isInteger(auto!)).toBeTrue();
            expect(Number.isInteger(range!)).toBeTrue();
        }
    });
});

describe("generateEnvironment - pocket prevention", () => {
    test("keeps free space connected under high clustering across deterministic seeds", () => {
        const width = 200;
        const height = 200;
        const cellSize = 20;
        const cols = width / cellSize;
        const rows = height / cellSize;

        for (let i = 0; i < 100; i++) {
            const seed = `pocket-regression-${i}`;
            const env = generateEnvironment({
                width,
                height,
                cellSize,
                obstacleRatio: 45,
                clusteringProb: 100,
                seed,
            });

            const freeComponents = countFreeComponentsFromEnv(env, cols, rows, cellSize);
            expect(freeComponents).toBeLessThanOrEqual(1);
        }
    });
});

describe("clustering priority weighted distribution", () => {
    test("favors higher priorities when all priority buckets are available", () => {
        const rng = mulberry32(0xBADC0DE);
        const counts: [number, number, number] = [0, 0, 0];
        const draws = 60000;

        for (let i = 0; i < draws; i++) {
            const picked = pickWeightedClusteringPriority(rng, [1, 2, 3]);
            expect(picked).not.toBeNull();
            counts[(picked! - 1) as 0 | 1 | 2] += 1;
        }

        const p1 = counts[0] / draws;
        const p2 = counts[1] / draws;
        const p3 = counts[2] / draws;

        // Expect strict ordering with weights 1:2:3.
        expect(p3).toBeGreaterThan(p2);
        expect(p2).toBeGreaterThan(p1);

        // Theoretical probabilities are [1/6, 2/6, 3/6].
        expect(Math.abs(p1 - 1 / 6)).toBeLessThan(0.02);
        expect(Math.abs(p2 - 2 / 6)).toBeLessThan(0.02);
        expect(Math.abs(p3 - 3 / 6)).toBeLessThan(0.02);
    });

    test("respects reduced availability subsets", () => {
        const rng = mulberry32(0xFEED123);
        const counts: [number, number] = [0, 0];
        const draws = 40000;

        for (let i = 0; i < draws; i++) {
            const picked = pickWeightedClusteringPriority(rng, [1, 3]);
            expect(picked === 1 || picked === 3).toBeTrue();
            if (picked === 1) counts[0] += 1;
            if (picked === 3) counts[1] += 1;
        }

        const p1 = counts[0] / draws;
        const p3 = counts[1] / draws;

        // With weights 1 and 3, expected probabilities are 1/4 and 3/4.
        expect(p3).toBeGreaterThan(p1);
        expect(Math.abs(p1 - 0.25)).toBeLessThan(0.02);
        expect(Math.abs(p3 - 0.75)).toBeLessThan(0.02);
    });
});

describe("traceMergedObstaclePolygons", () => {
    test("merges orthogonally connected cells into a single polygon", () => {
        const cols = 3;
        const rows = 2;
        const cellSize = 10;
        const grid = new Uint8Array([
            1, 1, 0,
            1, 0, 0,
        ]);

        const polygons = traceMergedObstaclePolygons(grid, cols, rows, cellSize, cols * cellSize, rows * cellSize);

        expect(polygons).toHaveLength(1);
        expect(computePolygonArea(polygons[0]!)).toBe(300);

        expect(isPointInPolygon({ x: 5, y: 5 }, polygons[0]!)).toBeTrue();
        expect(isPointInPolygon({ x: 15, y: 5 }, polygons[0]!)).toBeTrue();
        expect(isPointInPolygon({ x: 5, y: 15 }, polygons[0]!)).toBeTrue();
        expect(isPointInPolygon({ x: 15, y: 15 }, polygons[0]!)).toBeFalse();
    });

    test("keeps diagonally touching cells as separate polygons", () => {
        const cols = 2;
        const rows = 2;
        const cellSize = 10;
        const grid = new Uint8Array([
            1, 0,
            0, 1,
        ]);

        const polygons = traceMergedObstaclePolygons(grid, cols, rows, cellSize, cols * cellSize, rows * cellSize);

        expect(polygons).toHaveLength(2);
        expect(polygons.map((polygon) => computePolygonArea(polygon)).sort((a, b) => a - b)).toEqual([100, 100]);
    });
});


