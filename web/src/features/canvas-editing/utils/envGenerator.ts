import polygonClipping from "polygon-clipping";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import {
    COORD_SYSTEM,
    ENV_FORMAT,
    defaultObjectTypeForEnv,
    type CoordSystemType,
    type EnvFormat,
    type EnvType,
    type ObjectType,
} from "@/config/db-ops/enums";

// ============================================================================
// PERFORMANCE NOTES
// ============================================================================
//
// Pocket validation uses local connectivity flood-fill with reusable scratch
// buffers to avoid per-candidate global connectivity structure rebuilds.
//

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

export interface GeneratorParams {
    width: number;
    height: number;
    cellSize: number;
    obstacleRatio?: number | [number, number];
    clusteringProb?: number | [number, number];
    seed: string;
}

export interface GeneratedEnvironment {
    boundary: Point[];
    obstacles: Point[][];
    startEndPoint: Point;
    usedClusteringPct: number;
    usedObstacleRatioPct: number;
    pickedObstacleRatioPct: number | null;
    pickedClusteringPct: number | null;
    usedSeedHex: string;
}

export interface GeneratorSystemParams {
    format: EnvFormat;
    type: EnvType;
    coordSystem: CoordSystemType;
}

export interface GeneratorSystemValidationResult {
    ok: boolean;
    error: string | null;
}

export function validateGeneratorSystemParams(
    params: Pick<GeneratorSystemParams, "format" | "coordSystem">,
): GeneratorSystemValidationResult {
    if (params.format !== ENV_FORMAT.POLYGON) {
        return {
            ok: false,
            error: "Generator currently supports only Polygon environment format.",
        };
    }

    if (params.coordSystem !== COORD_SYSTEM.CARTESIAN) {
        return {
            ok: false,
            error: "Generator currently supports only Cartesian coordinate system.",
        };
    }

    return { ok: true, error: null };
}

export interface CompliantGeneratorParams extends GeneratorParams {
    systemParams: GeneratorSystemParams;
}

export interface CompliantGeneratedEnvironment {
    environment: GeneratedEnvironment;
    objectType: ObjectType;
}

export type CompliantGenerationResult =
    | { ok: true; value: CompliantGeneratedEnvironment }
    | { ok: false; error: string };

export function generateCompliantEnvironment(
    params: CompliantGeneratorParams,
): CompliantGenerationResult {
    const { systemParams, ...generatorParams } = params;

    const validation = validateGeneratorSystemParams({
        format: systemParams.format,
        coordSystem: systemParams.coordSystem,
    });

    if (!validation.ok) {
        return {
            ok: false,
            error: validation.error ?? "Unsupported system environment setup for generator.",
        };
    }

    const environment = generateEnvironment(generatorParams);
    const objectType = defaultObjectTypeForEnv(systemParams.type);

    return {
        ok: true,
        value: {
            environment,
            objectType,
        },
    };
}

// ============================================================================
// SEEDED PRNG — MULBERRY32
// ============================================================================

export function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(s: string): number {
    if (/^0x[0-9a-f]+$/i.test(s.trim())) return (parseInt(s.trim(), 16)) >>> 0;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// ============================================================================
// CORE HELPERS
// ============================================================================

class CandidatePool {
    private values: number[] = [];
    private positionByIdx: Int32Array;

    constructor(size: number) {
        this.positionByIdx = new Int32Array(size);
        this.positionByIdx.fill(-1);
    }

    size(): number {
        return this.values.length;
    }

    has(idx: number): boolean {
        return this.positionByIdx[idx] !== -1;
    }

    add(idx: number): void {
        if (this.positionByIdx[idx] !== -1) return;
        this.positionByIdx[idx] = this.values.length;
        this.values.push(idx);
    }

    remove(idx: number): void {
        const pos = this.positionByIdx[idx] as number;
        if (pos === -1) return;
        const lastPos = this.values.length - 1;
        const lastIdx = this.values[lastPos] as number;

        this.values[pos] = lastIdx;
        this.positionByIdx[lastIdx] = pos;

        this.values.pop();
        this.positionByIdx[idx] = -1;
    }

    getAt(pos: number): number {
        return this.values[pos] as number;
    }

    upsert(idx: number, shouldContain: boolean): void {
        if (shouldContain) {
            this.add(idx);
            return;
        }
        this.remove(idx);
    }
}

const ORTHO_DIRS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

const DIAG_DIRS: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];

const CLUSTERING_PRIORITY_WEIGHTS: ReadonlyArray<number> = [1, 2, 3];

export function pickWeightedClusteringPriority(
    rng: () => number,
    availablePriorities: ReadonlyArray<1 | 2 | 3>,
): 1 | 2 | 3 | null {
    if (availablePriorities.length === 0) return null;

    let totalWeight = 0;
    for (const priority of availablePriorities) {
        totalWeight += CLUSTERING_PRIORITY_WEIGHTS[priority - 1] as number;
    }

    if (totalWeight <= 0) return null;

    let draw = rng() * totalWeight;
    for (const priority of availablePriorities) {
        const weight = CLUSTERING_PRIORITY_WEIGHTS[priority - 1] as number;
        if (draw < weight) return priority;
        draw -= weight;
    }

    return availablePriorities[availablePriorities.length - 1] ?? null;
}

function traceZonePolygon(width: number, height: number): Point[] {
    return [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
    ];
}

function toCellRing(
    idx: number,
    cols: number,
    cellSize: number,
    width: number,
    height: number,
): [number, number][] {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const x0 = Math.min(x * cellSize, width);
    const y0 = Math.min(y * cellSize, height);
    const x1 = Math.min((x + 1) * cellSize, width);
    const y1 = Math.min((y + 1) * cellSize, height);

    return [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
    ];
}

function ringToPoints(ring: [number, number][]): Point[] {
    return ring.slice(0, -1).map(([x, y]) => ({ x, y }));
}

function buildRectanglePolygon(
    startX: number,
    endXExclusive: number,
    y: number,
    cellSize: number,
    width: number,
    height: number,
): Point[] {
    const x0 = Math.min(startX * cellSize, width);
    const x1 = Math.min(endXExclusive * cellSize, width);
    const y0 = Math.min(y * cellSize, height);
    const y1 = Math.min((y + 1) * cellSize, height);

    return [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
    ];
}

function buildHoleSafeRunPolygons(
    componentCells: readonly number[],
    cols: number,
    cellSize: number,
    width: number,
    height: number,
): Point[][] {
    const sortedCells = [...componentCells].sort((a, b) => a - b);
    const polygons: Point[][] = [];

    let i = 0;
    while (i < sortedCells.length) {
        const startIdx = sortedCells[i] as number;
        const y = Math.floor(startIdx / cols);
        const startX = startIdx % cols;
        let endXExclusive = startX + 1;
        i += 1;

        while (i < sortedCells.length) {
            const nextIdx = sortedCells[i] as number;
            const nextY = Math.floor(nextIdx / cols);
            const nextX = nextIdx % cols;
            if (nextY !== y || nextX !== endXExclusive) break;
            endXExclusive += 1;
            i += 1;
        }

        polygons.push(buildRectanglePolygon(startX, endXExclusive, y, cellSize, width, height));
    }

    return polygons;
}

function mergeComponentCellsToPolygons(
    componentCells: readonly number[],
    cols: number,
    cellSize: number,
    width: number,
    height: number,
): Point[][] {
    if (componentCells.length === 0) return [];

    const componentPolygons = componentCells.map((idx) => [toCellRing(idx, cols, cellSize, width, height)]);
    let merged = polygonClipping.union(componentPolygons[0]!);

    for (let i = 1; i < componentPolygons.length; i++) {
        merged = polygonClipping.union(merged, componentPolygons[i]!);
    }

    if (merged.some((polygon) => polygon.length > 1)) {
        return buildHoleSafeRunPolygons(componentCells, cols, cellSize, width, height);
    }

    return merged.map((polygon) => ringToPoints(polygon[0] as [number, number][]));
}

export function traceMergedObstaclePolygons(
    grid: Uint8Array,
    cols: number,
    rows: number,
    cellSize: number,
    width: number,
    height: number,
): Point[][] {
    const totalCells = cols * rows;
    const visited = new Uint8Array(totalCells);
    const queue = new Uint32Array(totalCells);
    const componentCells: number[] = [];
    const polygons: Point[][] = [];

    for (let idx = 0; idx < totalCells; idx++) {
        if (grid[idx] !== 1 || visited[idx] === 1) continue;

        visited[idx] = 1;
        componentCells.length = 0;

        let head = 0;
        let tail = 0;
        queue[tail++] = idx;

        while (head < tail) {
            const current = queue[head++] as number;
            componentCells.push(current);

            const x = current % cols;
            const y = Math.floor(current / cols);

            if (x > 0) {
                const left = current - 1;
                if (grid[left] === 1 && visited[left] === 0) {
                    visited[left] = 1;
                    queue[tail++] = left;
                }
            }
            if (x + 1 < cols) {
                const right = current + 1;
                if (grid[right] === 1 && visited[right] === 0) {
                    visited[right] = 1;
                    queue[tail++] = right;
                }
            }
            if (y > 0) {
                const up = current - cols;
                if (grid[up] === 1 && visited[up] === 0) {
                    visited[up] = 1;
                    queue[tail++] = up;
                }
            }
            if (y + 1 < rows) {
                const down = current + cols;
                if (grid[down] === 1 && visited[down] === 0) {
                    visited[down] = 1;
                    queue[tail++] = down;
                }
            }
        }

        const mergedPolygons = mergeComponentCellsToPolygons(componentCells, cols, cellSize, width, height);
        for (const polygon of mergedPolygons) {
            if (polygon.length > 0) {
                polygons.push(polygon);
            }
        }
    }

    return polygons;
}

function isInBounds(x: number, y: number, cols: number, rows: number): boolean {
    return x >= 0 && y >= 0 && x < cols && y < rows;
}

function toIndex(x: number, y: number, cols: number): number {
    return y * cols + x;
}

function isOnEdge(x: number, y: number, cols: number, rows: number): boolean {
    return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
}

function hasObstacleNeighbor8(grid: Uint8Array, x: number, y: number, cols: number, rows: number): boolean {
    for (const [dx, dy] of ORTHO_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInBounds(nx, ny, cols, rows) && grid[toIndex(nx, ny, cols)] === 1) return true;
    }
    for (const [dx, dy] of DIAG_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInBounds(nx, ny, cols, rows) && grid[toIndex(nx, ny, cols)] === 1) return true;
    }
    return false;
}

function hasObstacleNeighbor4(grid: Uint8Array, x: number, y: number, cols: number, rows: number): boolean {
    for (const [dx, dy] of ORTHO_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInBounds(nx, ny, cols, rows) && grid[toIndex(nx, ny, cols)] === 1) return true;
    }
    return false;
}

function countObstacleNeighbor4(grid: Uint8Array, x: number, y: number, cols: number, rows: number): number {
    let count = 0;
    for (const [dx, dy] of ORTHO_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInBounds(nx, ny, cols, rows) && grid[toIndex(nx, ny, cols)] === 1) {
            count += 1;
        }
    }
    return count;
}

function diagonalNeighborHasOrthogonalBridge(
    grid: Uint8Array,
    x: number,
    y: number,
    cols: number,
    rows: number,
): boolean {
    let hasOrthogonalObstacleNeighbor = false;

    // First pass: check orthogonal neighbors (early exit if found)
    for (const [dx, dy] of ORTHO_DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInBounds(nx, ny, cols, rows) && grid[toIndex(nx, ny, cols)] === 1) {
            hasOrthogonalObstacleNeighbor = true;
            break;
        }
    }

    // Short-circuit if no orthogonal neighbors
    if (!hasOrthogonalObstacleNeighbor) return false;

    // Any diagonal obstacle must be side-connected to at least one orthogonal
    // obstacle neighbor of the target cell.
    for (const [dx, dy] of DIAG_DIRS) {
        const dxCell = x + dx;
        const dyCell = y + dy;
        if (!isInBounds(dxCell, dyCell, cols, rows)) continue;
        if (grid[toIndex(dxCell, dyCell, cols)] !== 1) continue;

        const bridgeAX = x + dx;
        const bridgeAY = y;
        const bridgeBX = x;
        const bridgeBY = y + dy;

        const bridgeAIsObstacle = isInBounds(bridgeAX, bridgeAY, cols, rows)
            && grid[toIndex(bridgeAX, bridgeAY, cols)] === 1;
        const bridgeBIsObstacle = isInBounds(bridgeBX, bridgeBY, cols, rows)
            && grid[toIndex(bridgeBX, bridgeBY, cols)] === 1;

        const hasBridge = bridgeAIsObstacle || bridgeBIsObstacle;

        if (!hasBridge) return false;
    }

    return true;
}

function isNonClusteringCandidate(grid: Uint8Array, idx: number, cols: number, rows: number): boolean {
    if (grid[idx] === 1) return false;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    return !hasObstacleNeighbor8(grid, x, y, cols, rows);
}

function getClusteringPriorityForIdx(grid: Uint8Array, idx: number, cols: number, rows: number): 0 | 1 | 2 | 3 {
    if (grid[idx] === 1) return 0;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (!hasObstacleNeighbor4(grid, x, y, cols, rows)) return 0;
    if (!diagonalNeighborHasOrthogonalBridge(grid, x, y, cols, rows)) return 0;

    const orthogonalObstacleCount = countObstacleNeighbor4(grid, x, y, cols, rows);
    if (orthogonalObstacleCount <= 0) return 0;
    if (orthogonalObstacleCount >= 3) return 3;
    return orthogonalObstacleCount as 1 | 2;
}

function getPriorityPool(
    clusteringPoolsByPriority: [CandidatePool, CandidatePool, CandidatePool],
    priority: 1 | 2 | 3,
): CandidatePool {
    if (priority === 1) return clusteringPoolsByPriority[0];
    if (priority === 2) return clusteringPoolsByPriority[1];
    return clusteringPoolsByPriority[2];
}

function updateClusteringPriorityBucketForIdx(
    grid: Uint8Array,
    idx: number,
    cols: number,
    rows: number,
    clusteringPoolsByPriority: [CandidatePool, CandidatePool, CandidatePool],
    clusteringPriorityByIdx: Int8Array,
): void {
    const previousPriority = clusteringPriorityByIdx[idx] as 0 | 1 | 2 | 3;
    if (previousPriority > 0) {
        getPriorityPool(clusteringPoolsByPriority, previousPriority as 1 | 2 | 3).remove(idx);
        clusteringPriorityByIdx[idx] = 0;
    }

    const nextPriority = getClusteringPriorityForIdx(grid, idx, cols, rows);
    if (nextPriority > 0) {
        getPriorityPool(clusteringPoolsByPriority, nextPriority as 1 | 2 | 3).add(idx);
        clusteringPriorityByIdx[idx] = nextPriority;
    }
}

function initializeCandidatePools(
    grid: Uint8Array,
    cols: number,
    rows: number,
    nonClusteringPool: CandidatePool,
    clusteringPoolsByPriority: [CandidatePool, CandidatePool, CandidatePool],
    clusteringPriorityByIdx: Int8Array,
): void {
    const total = cols * rows;
    for (let idx = 0; idx < total; idx++) {
        nonClusteringPool.upsert(idx, isNonClusteringCandidate(grid, idx, cols, rows));
        updateClusteringPriorityBucketForIdx(
            grid,
            idx,
            cols,
            rows,
            clusteringPoolsByPriority,
            clusteringPriorityByIdx,
        );
    }
}

function updateCandidatePoolsAroundCell(
    grid: Uint8Array,
    cols: number,
    rows: number,
    cellIdx: number,
    nonClusteringPool: CandidatePool,
    clusteringPoolsByPriority: [CandidatePool, CandidatePool, CandidatePool],
    clusteringPriorityByIdx: Int8Array,
): void {
    const cellX = cellIdx % cols;
    const cellY = Math.floor(cellIdx / cols);
    const minX = Math.max(0, cellX - 1);
    const maxX = Math.min(cols - 1, cellX + 1);
    const minY = Math.max(0, cellY - 1);
    const maxY = Math.min(rows - 1, cellY + 1);

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const idx = toIndex(x, y, cols);
            nonClusteringPool.upsert(idx, isNonClusteringCandidate(grid, idx, cols, rows));
            updateClusteringPriorityBucketForIdx(
                grid,
                idx,
                cols,
                rows,
                clusteringPoolsByPriority,
                clusteringPriorityByIdx,
            );
        }
    }
}

function pickFromNonClusteringPool(
    pool: CandidatePool,
    grid: Uint8Array,
    cols: number,
    rows: number,
    rng: () => number,
): number | null {
    const size = pool.size();
    if (size === 0) return null;

    const start = Math.floor(rng() * size);
    for (let step = 0; step < size; step++) {
        const idx = pool.getAt((start + step) % size);
        if (!isNonClusteringCandidate(grid, idx, cols, rows)) {
            pool.remove(idx);
            continue;
        }
        return idx;
    }

    return null;
}

function pickFromClusteringPriorityPool(
    pool: CandidatePool,
    priority: 1 | 2 | 3,
    grid: Uint8Array,
    cols: number,
    rows: number,
    clusteringPoolsByPriority: [CandidatePool, CandidatePool, CandidatePool],
    clusteringPriorityByIdx: Int8Array,
    visited: Uint8Array,
    queue: Uint32Array,
    rng: () => number,
): number | null {
    const size = pool.size();
    if (size === 0) return null;

    const start = Math.floor(rng() * size);
    for (let step = 0; step < size; step++) {
        const idx = pool.getAt((start + step) % size);
        if ((clusteringPriorityByIdx[idx] as 0 | 1 | 2 | 3) !== priority) {
            pool.remove(idx);
            continue;
        }

        const actualPriority = getClusteringPriorityForIdx(grid, idx, cols, rows);
        if (actualPriority !== priority) {
            updateClusteringPriorityBucketForIdx(
                grid,
                idx,
                cols,
                rows,
                clusteringPoolsByPriority,
                clusteringPriorityByIdx,
            );
            continue;
        }

        if (!wouldCreatePocketByLocalConnectivity(grid, idx, cols, rows, visited, queue)) {
            return idx;
        }
    }

    return null;
}

function pickFromWeightedClusteringPriorityPools(
    clusteringPoolsByPriority: [CandidatePool, CandidatePool, CandidatePool],
    grid: Uint8Array,
    cols: number,
    rows: number,
    clusteringPriorityByIdx: Int8Array,
    visited: Uint8Array,
    queue: Uint32Array,
    rng: () => number,
): number | null {
    const remaining: Record<1 | 2 | 3, boolean> = { 1: true, 2: true, 3: true };

    for (let attempt = 0; attempt < 3; attempt++) {
        const availablePriorities: Array<1 | 2 | 3> = [];

        for (const priority of [1, 2, 3] as const) {
            if (!remaining[priority]) continue;
            const pool = getPriorityPool(clusteringPoolsByPriority, priority);
            if (pool.size() === 0) continue;
            availablePriorities.push(priority);
        }

        const chosenPriority = pickWeightedClusteringPriority(rng, availablePriorities);
        if (chosenPriority === null) return null;

        const picked = pickFromClusteringPriorityPool(
            getPriorityPool(clusteringPoolsByPriority, chosenPriority),
            chosenPriority,
            grid,
            cols,
            rows,
            clusteringPoolsByPriority,
            clusteringPriorityByIdx,
            visited,
            queue,
            rng,
        );

        if (picked !== null) return picked;
        remaining[chosenPriority] = false;
    }

    return null;
}

function wouldCreatePocketByLocalConnectivity(
    grid: Uint8Array,
    candidateIdx: number,
    cols: number,
    rows: number,
    visited: Uint8Array,
    queue: Uint32Array,
): boolean {
    const candidateX = candidateIdx % cols;
    const candidateY = Math.floor(candidateIdx / cols);
    let neighborCount = 0;
    let seed = -1;
    let n1 = -1;
    let n2 = -1;
    let n3 = -1;

    for (const [dx, dy] of ORTHO_DIRS) {
        const nx = candidateX + dx;
        const ny = candidateY + dy;
        if (!isInBounds(nx, ny, cols, rows)) continue;
        const nIdx = toIndex(nx, ny, cols);
        if (grid[nIdx] !== 0) continue;

        if (neighborCount === 0) {
            seed = nIdx;
        } else if (neighborCount === 1) {
            n1 = nIdx;
        } else if (neighborCount === 2) {
            n2 = nIdx;
        } else {
            n3 = nIdx;
        }
        neighborCount += 1;
    }

    // 0-1 reachable free neighbors can never be split by removing candidate.
    if (neighborCount <= 1) return false;

    visited.fill(0);
    let head = 0;
    let tail = 0;

    visited[seed] = 1;
    queue[tail++] = seed;

    while (head < tail) {
        const cur = queue[head++] as number;
        const cx = cur % cols;
        const cy = Math.floor(cur / cols);

        const tryPush = (idx: number) => {
            if (idx === candidateIdx) return;
            if (grid[idx] === 1) return;
            if (visited[idx] === 1) return;
            visited[idx] = 1;
            queue[tail++] = idx;
        };

        if (cx > 0) tryPush(cur - 1);
        if (cx + 1 < cols) tryPush(cur + 1);
        if (cy > 0) tryPush(cur - cols);
        if (cy + 1 < rows) tryPush(cur + cols);
    }

    // If any orthogonal free neighbor is unreachable once candidate is removed,
    // candidate is an articulation point and would split free space.
    if (n1 >= 0 && visited[n1] === 0) return true;
    if (n2 >= 0 && visited[n2] === 0) return true;
    if (n3 >= 0 && visited[n3] === 0) return true;
    return false;
}

function clampPct(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

function classifyObstacleComponents(
    grid: Uint8Array,
    cols: number,
    rows: number,
): { boundaryGrid: Uint8Array; interiorGrid: Uint8Array } {
    const totalCells = cols * rows;
    const visited = new Uint8Array(totalCells);
    const queue = new Uint32Array(totalCells);
    const boundaryGrid = new Uint8Array(totalCells);
    const interiorGrid = new Uint8Array(totalCells);

    for (let idx = 0; idx < totalCells; idx++) {
        if (grid[idx] !== 1 || visited[idx] === 1) continue;

        visited[idx] = 1;
        const componentCells: number[] = [idx];
        let touchesBoundary = false;

        let head = 0;
        let tail = 1;
        queue[0] = idx;

        while (head < tail) {
            const current = queue[head++] as number;
            const x = current % cols;
            const y = Math.floor(current / cols);

            if (isOnEdge(x, y, cols, rows)) {
                touchesBoundary = true;
            }

            if (x > 0) {
                const left = current - 1;
                if (grid[left] === 1 && visited[left] === 0) {
                    visited[left] = 1;
                    componentCells.push(left);
                    queue[tail++] = left;
                }
            }
            if (x + 1 < cols) {
                const right = current + 1;
                if (grid[right] === 1 && visited[right] === 0) {
                    visited[right] = 1;
                    componentCells.push(right);
                    queue[tail++] = right;
                }
            }
            if (y > 0) {
                const up = current - cols;
                if (grid[up] === 1 && visited[up] === 0) {
                    visited[up] = 1;
                    componentCells.push(up);
                    queue[tail++] = up;
                }
            }
            if (y + 1 < rows) {
                const down = current + cols;
                if (grid[down] === 1 && visited[down] === 0) {
                    visited[down] = 1;
                    componentCells.push(down);
                    queue[tail++] = down;
                }
            }
        }

        const targetGrid = touchesBoundary ? boundaryGrid : interiorGrid;
        for (const cellIdx of componentCells) {
            targetGrid[cellIdx] = 1;
        }
    }

    return { boundaryGrid, interiorGrid };
}

function computeDistanceToNearestObstacle(
    grid: Uint8Array,
    cols: number,
    rows: number,
): Uint32Array {
    const totalCells = cols * rows;
    const distanceGrid = new Uint32Array(totalCells);
    const queue = new Uint32Array(totalCells);

    // Initialize: distance 0 for obstacles and boundary cells
    let queueTail = 0;
    for (let idx = 0; idx < totalCells; idx++) {
        if (grid[idx] === 1) {
            distanceGrid[idx] = 0;
            queue[queueTail++] = idx;
        }
    }

    // Add boundary edge cells
    for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
            if (isOnEdge(x, y, cols, rows) && grid[toIndex(x, y, cols)] === 0) {
                const idx = toIndex(x, y, cols);
                distanceGrid[idx] = 0;
                queue[queueTail++] = idx;
            }
        }
    }

    // Multi-source BFS: expand from all obstacles and boundary
    let queueHead = 0;
    while (queueHead < queueTail) {
        const current = queue[queueHead++] as number;
        const x = current % cols;
        const y = Math.floor(current / cols);
        const currentDist = distanceGrid[current] as number;

        // Check all 4-neighbors
        const neighbors = [
            x > 0 ? current - 1 : -1,
            x + 1 < cols ? current + 1 : -1,
            y > 0 ? current - cols : -1,
            y + 1 < rows ? current + cols : -1,
        ];

        for (const neighbor of neighbors) {
            if (neighbor < 0) continue;
            if (distanceGrid[neighbor] !== 0) continue; // Already visited (distance > 0 or uninitialized)

            distanceGrid[neighbor] = currentDist + 1;
            queue[queueTail++] = neighbor;
        }
    }

    return distanceGrid;
}

function findLoneliesPoint(
    grid: Uint8Array,
    cols: number,
    rows: number,
    cellSize: number,
    width: number,
    height: number,
): Point {
    const distanceGrid = computeDistanceToNearestObstacle(grid, cols, rows);

    let bestX = -1;
    let bestY = -1;
    let bestDist = -1;

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const idx = toIndex(x, y, cols);
            if (grid[idx] === 1) continue; // Skip obstacles

            const dist = distanceGrid[idx] as number;
            if (dist > bestDist) {
                bestDist = dist;
                bestX = x;
                bestY = y;
            }
        }
    }

    if (bestX < 0 || bestY < 0) {
        return { x: width / 2, y: height / 2 };
    }

    return {
        x: Math.min((bestX + 0.5) * cellSize, width),
        y: Math.min((bestY + 0.5) * cellSize, height),
    };
}

// ============================================================================
// IMPLEMENTATION SPEC (DOCUMENTATION)
// ============================================================================

// Environment generator proposal (documentation / implementation spec)
//
// Goal
// ----
// Construct obstacle cells iteratively (cell-by-cell), instead of placing many
// and stabilizing afterwards.
//
// This spec defines:
// - candidate selection rules,
// - clustering / non-clustering operation switching,
// - pocket-prevention semantics,
// - target obstacle count calculation,
// - output contract at cell level.
//
// Terminology
// -----------
// - Free cell: currently not obstacle.
// - Obstacle cell: currently occupied by obstacle.
// - Zone edge (Z): outside of the rectangular grid.
// - Candidate cell (C): free cell evaluated for placement.
// - Obstacle neighbour (O): already placed obstacle cell.
//
// Iteration state (recomputed every placement)
// --------------------------------------------
// 1) AvailableCellsForNonClustering
// 2) AvailableCellsForClustering
//
// Both datasets MUST be recomputed from scratch at each iteration.
//
// Operation selection
// -------------------
// At each placement iteration, operation type is selected by Bernoulli draw:
// - P(Clustering) = clusteringPct / 100
// - P(NonClustering) = 1 - P(Clustering)
//
// Target obstacle count
// ---------------------
// For explicit obstacle ratio, target count is:
//   targetObstacleCells = floor(totalCells * obstacleRatioPct / 100)
//
// Candidate rules
// ---------------
// Rules for AvailableCellsForNonClustering:
// - Candidate has NO obstacle neighbours in 8-neighbourhood
//   (orthogonal + diagonal).
//
//   0 0 0
//   0 C 0
//   0 0 0
//
// - Candidate may be next to zone edge.
//
//   Z 0 0
//   Z C 0
//   Z Z Z
//
//   Or:
//
//   Z 0 0
//   Z C 0
//   Z 0 0
//
// Rules for AvailableCellsForClustering:
// - Candidate MUST have at least one ORTHOGONAL (4-neighbour) obstacle neighbour.
//   Diagonal-only contact is insufficient.
// - A diagonal obstacle touching the candidate is only relevant if that diagonal
//   obstacle is also adjacent to one of the candidate's orthogonal neighbors.
//   In other words, every diagonal obstacle must have an orthogonal bridge
//   back to the candidate's 4-neighbourhood to count for clustering.
//
// RIGHT: Candidate has orthogonal obstacle neighbor
//   0 O O
//   0 C 0
//   0 0 0
//
// WRONG: Candidate has only diagonal obstacle neighbors (no orthogonal)
//   0 0 O
//   0 C 0
//   0 0 0
//
// RIGHT only if the diagonal obstacle is connected through a candidate-side
// orthogonal neighbor.
//   0 O O
//   O C 0
//   0 0 0
//
// Pocket-prevention rule
// ----------------------
// Every candidate in AvailableCellsForClustering MUST be validated for pocket
// creation before it can be selected.
//
// Pocket definition:
// - A pocket is an enclosed free-space island created by placing the candidate,
//   regardless of any chosen start point.
//
// If candidate forms a pocket, candidate is removed from clustering candidates.
//
// Fallback / switching rules
// --------------------------
// - If chosen operation is NonClustering, but its candidate set is empty,
//   switch to Clustering and pick from its candidates.
// - If chosen operation is Clustering, but its candidate set is empty,
//   switch to NonClustering and pick from its candidates.
// - If BOTH candidate sets are empty before reaching targetObstacleCells,
//   STOP early and report achieved ratio/count.
//
// High-level pseudo code
// ----------------------
// CalcObstacleCellCount()  // using floor(totalCells * obstacleRatioPct / 100)
//
// For each obstacle cell to place:
// begin
//   CalcOperationType() // Bernoulli draw by clusteringPct
//
//   Case OperationType of:
//     OperationType::NonClustering:
//       begin
//         CalcAvailableCellsForNonClustering()
//         if not AvailableCellsForNonClustering.IsEmpty() then
//           PickRandomAvailableCellForNonClustering()
//         else
//           begin
//             CalcAvailableCellsForClustering()
//             FilterPocketFormingCellsFromClustering()
//             if not AvailableCellsForClustering.IsEmpty() then
//               PickRandomAvailableCellForClustering()
//             else
//               StopEarly()
//           end
//       end
//
//     OperationType::Clustering:
//       begin
//         CalcAvailableCellsForClustering()
//         FilterPocketFormingCellsFromClustering()
//         if not AvailableCellsForClustering.IsEmpty() then
//           PickRandomAvailableCellForClustering()
//         else
//           begin
//             CalcAvailableCellsForNonClustering()
//             if not AvailableCellsForNonClustering.IsEmpty() then
//               PickRandomAvailableCellForNonClustering()
//             else
//               StopEarly()
//           end
//       end
//   end
// end
//
// Output contract:
// - `boundary`: rectangular zone polygon.
// - `obstacles`: one or more polygons per connected obstacle component.
// - Returned obstacle polygons do not encode holes.

// ============================================================================
// PUBLIC API - RATIO/CLUSTERING RESOLUTION HELPERS
// ============================================================================

const AUTO_RATIO_MIN = 5;
const AUTO_RATIO_RANGE = 55; // → [5, 60]%

export function computeResolvedObstacleRatioPct(seed: string, range?: [number, number]): number | null {
    if (!seed.trim()) return null;
    const draw = mulberry32(hashSeed(seed.trim()) ^ 0x9e3779b9)();
    if (range !== undefined) {
        const lo = Math.min(range[0], range[1]);
        const hi = Math.max(range[0], range[1]);
        return Math.round(lo + draw * (hi - lo));
    }
    return Math.round(AUTO_RATIO_MIN + draw * AUTO_RATIO_RANGE);
}

export function computeResolvedClusteringPct(seed: string, range?: [number, number]): number | null {
    if (!seed.trim()) return null;
    const draw = mulberry32(hashSeed(seed.trim()))();
    if (range !== undefined) {
        const lo = Math.min(range[0], range[1]);
        const hi = Math.max(range[0], range[1]);
        return Math.round(lo + draw * (hi - lo));
    }
    return Math.round(draw * 100);
}

// ============================================================================
// MAIN GENERATOR
// ============================================================================

/**
 * Generates a rectangular environment with obstacle geometry and "loneliest island"
 * start/end point selection (furthest point from boundaries and obstacles).
 */
export function generateEnvironment({
    width,
    height,
    cellSize,
    obstacleRatio,
    clusteringProb,
    seed,
}: GeneratorParams): GeneratedEnvironment {
    if (width <= 0 || height <= 0 || cellSize <= 0) {
        return {
            boundary: [],
            obstacles: [],
            startEndPoint: { x: 0, y: 0 },
            usedClusteringPct: 0,
            usedObstacleRatioPct: 0,
            pickedObstacleRatioPct: null,
            pickedClusteringPct: null,
            usedSeedHex: "0x00000000",
        };
    }

    const seedNum = seed.trim()
        ? hashSeed(seed.trim())
        : ((Date.now() ^ (Math.random() * 0x100000000 >>> 0)) >>> 0);

    const usedSeedHex = `0x${seedNum.toString(16).toUpperCase().padStart(8, "0")}`;
    const rng = mulberry32(seedNum);

    // Resolve clustering percentage
    const clusteringDraw = rng();
    const resolvedClusteringPct = clusteringProb === undefined
        ? Math.round(clusteringDraw * 100)
        : Array.isArray(clusteringProb)
            ? Math.round(Math.min(clusteringProb[0], clusteringProb[1]) + clusteringDraw * Math.abs(clusteringProb[1] - clusteringProb[0]))
            : clusteringProb;

    const pickedClusteringPct = Array.isArray(clusteringProb) ? resolvedClusteringPct : null;

    // Resolve obstacle ratio percentage
    const obstacleDraw = mulberry32(seedNum ^ 0x9e3779b9)();
    const resolvedObstaclePct = obstacleRatio === undefined
        ? Math.round(AUTO_RATIO_MIN + obstacleDraw * AUTO_RATIO_RANGE)
        : Array.isArray(obstacleRatio)
            ? Math.round(Math.min(obstacleRatio[0], obstacleRatio[1]) + obstacleDraw * Math.abs(obstacleRatio[1] - obstacleRatio[0]))
            : obstacleRatio;

    const pickedObstaclePct = Array.isArray(obstacleRatio) ? resolvedObstaclePct : null;

    const usedClusteringPct = Math.round(clampPct(resolvedClusteringPct));
    const requestedObstaclePct = clampPct(resolvedObstaclePct);

    const cols = Math.max(1, Math.floor(width / cellSize));
    const rows = Math.max(1, Math.floor(height / cellSize));
    const totalCells = cols * rows;
    const targetObstacleCells = Math.floor(totalCells * requestedObstaclePct / 100);

    const obstacleGrid = new Uint8Array(totalCells);
    let placedObstacleCells = 0;
    const pocketVisited = new Uint8Array(totalCells);
    const pocketQueue = new Uint32Array(totalCells);
    const nonClusteringPool = new CandidatePool(totalCells);
    const clusteringPoolsByPriority: [CandidatePool, CandidatePool, CandidatePool] = [
        new CandidatePool(totalCells),
        new CandidatePool(totalCells),
        new CandidatePool(totalCells),
    ];
    const clusteringPriorityByIdx = new Int8Array(totalCells);

    initializeCandidatePools(
        obstacleGrid,
        cols,
        rows,
        nonClusteringPool,
        clusteringPoolsByPriority,
        clusteringPriorityByIdx,
    );

    for (let i = 0; i < targetObstacleCells; i++) {
        const preferClustering = rng() < usedClusteringPct / 100;

        let picked = preferClustering
            ? pickFromWeightedClusteringPriorityPools(
                clusteringPoolsByPriority,
                obstacleGrid,
                cols,
                rows,
                clusteringPriorityByIdx,
                pocketVisited,
                pocketQueue,
                rng,
            )
            : pickFromNonClusteringPool(nonClusteringPool, obstacleGrid, cols, rows, rng);

        if (picked === null) {
            picked = preferClustering
                ? pickFromNonClusteringPool(nonClusteringPool, obstacleGrid, cols, rows, rng)
                : pickFromWeightedClusteringPriorityPools(
                    clusteringPoolsByPriority,
                    obstacleGrid,
                    cols,
                    rows,
                    clusteringPriorityByIdx,
                    pocketVisited,
                    pocketQueue,
                    rng,
                );
        }

        if (picked === null) {
            break;
        }

        const pickedIdx = picked;
        obstacleGrid[pickedIdx] = 1;
        nonClusteringPool.remove(pickedIdx);
        const previousPriority = clusteringPriorityByIdx[pickedIdx] as 0 | 1 | 2 | 3;
        if (previousPriority > 0) {
            getPriorityPool(clusteringPoolsByPriority, previousPriority as 1 | 2 | 3).remove(pickedIdx);
            clusteringPriorityByIdx[pickedIdx] = 0;
        }

        updateCandidatePoolsAroundCell(
            obstacleGrid,
            cols,
            rows,
            pickedIdx,
            nonClusteringPool,
            clusteringPoolsByPriority,
            clusteringPriorityByIdx,
        );

        placedObstacleCells += 1;
    }

    // Classify obstacles into boundary-touching vs interior components
    const { boundaryGrid, interiorGrid } = classifyObstacleComponents(obstacleGrid, cols, rows);

    // Compute interior obstacles (fully non-edge-touching)
    const interiorObstacles = traceMergedObstaclePolygons(interiorGrid, cols, rows, cellSize, width, height);

    // Compute new boundary by subtracting boundary-touching obstacles
    let boundary: Point[];
    const boundaryObstacles = traceMergedObstaclePolygons(boundaryGrid, cols, rows, cellSize, width, height);

    if (boundaryObstacles.length === 0) {
        // No boundary-touching obstacles; boundary is still a rectangle
        boundary = traceZonePolygon(width, height);
    } else {
        // Zone rectangle as a polygon (with outer ring only)
        const rectPolygon: Array<Array<[number, number]>> = [[
            [0, 0],
            [width, 0],
            [width, height],
            [0, height],
            [0, 0],
        ]];

        // Convert boundary obstacles to polygon-clipping format
        const boundaryObstaclePolygons = boundaryObstacles.map((poly) => [
            [...poly.map(p => [p.x, p.y] as [number, number]), [poly[0]!.x, poly[0]!.y] as [number, number]],
        ]);

        // Subtract boundary obstacles from the rectangle
        const diff = polygonClipping.difference(rectPolygon, ...boundaryObstaclePolygons);

        // Extract the outer ring from the result (diff[0]![0] is the outer boundary)
        if (diff.length > 0 && diff[0] && diff[0][0]) {
            boundary = ringToPoints(diff[0][0]!);
        } else {
            // Fallback to rectangular boundary if subtraction fails
            boundary = traceZonePolygon(width, height);
        }
    }

    const usedObstacleRatioPct = totalCells > 0
        ? Math.round((placedObstacleCells / totalCells) * 100)
        : 0;

    const startEndPoint = findLoneliesPoint(obstacleGrid, cols, rows, cellSize, width, height);

    return {
        boundary,
        obstacles: interiorObstacles,
        startEndPoint,
        usedClusteringPct,
        usedObstacleRatioPct,
        pickedObstacleRatioPct: pickedObstaclePct,
        pickedClusteringPct: pickedClusteringPct,
        usedSeedHex,
    };
}

