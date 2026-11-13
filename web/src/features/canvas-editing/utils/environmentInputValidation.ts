const CELL_FIT_TOLERANCE = 1e-9;

/**
 * Validates that width and height fit perfectly into cell-size tiles with at least 2×2 grid.
 *
 * Returns an error message if invalid (divisibility or grid size fails), or null if valid.
 * If width or height are not finite/positive, returns null (validation skipped until both are present).
 */
export function validateCellSizeFit(
    width: number,
    height: number,
    cellSize: number,
): string | null {
    // Skip validation if dimensions not yet present
    if (!isFinite(width) || width <= 0 || !isFinite(height) || height <= 0) return null;
    if (!isFinite(cellSize) || cellSize <= 0) return null;

    const colsExact = width / cellSize;
    const rowsExact = height / cellSize;
    const cols = Math.round(colsExact);
    const rows = Math.round(rowsExact);

    // Check divisibility: allow small floating-point error
    const colsRemainder = Math.abs(colsExact - cols);
    const rowsRemainder = Math.abs(rowsExact - rows);
    if (colsRemainder > CELL_FIT_TOLERANCE || rowsRemainder > CELL_FIT_TOLERANCE) {
        return `Cell size must divide Width and Height evenly (got ${cols}×${rows} + remainder).`;
    }

    // Check minimum grid size (2×2)
    if (cols < 2 || rows < 2) {
        return `Cell size too large: need at least 2×2 grid (got ${cols}×${rows}).`;
    }

    return null;
}

/**
 * Validates a range field value (e.g., obstacle ratio, clustering).
 * Accepts: empty string (auto), single integer N, or range N..M where both are in [min, max].
 *
 * Returns an error message if invalid format/range, or null if valid or empty.
 * Empty fields (which trigger auto-derivation) never produce errors.
 */
export function validateRangeField(
    raw: string | undefined,
    fieldName: string,
    min: number = 0,
    max: number = 100,
): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();

    // Empty is always valid (auto-derive from seed)
    if (!trimmed) return null;

    // Try range syntax: N..M
    const rangeMatch = trimmed.match(/^(-?\d+)\.\.(-?\d+)$/);
    if (rangeMatch) {
        const a = parseInt(rangeMatch[1]!, 10);
        const b = parseInt(rangeMatch[2]!, 10);
        if (!isFinite(a) || !isFinite(b)) {
            return `${fieldName}: invalid range format.`;
        }
        if (a < min || a > max) {
            return `${fieldName}: first value must be between ${min} and ${max} (got ${a}).`;
        }
        if (b < min || b > max) {
            return `${fieldName}: second value must be between ${min} and ${max} (got ${b}).`;
        }
        return null;
    }

    // Reject incomplete range syntax (ends with . or ..)
    if (trimmed.endsWith(".") || trimmed.endsWith("..")) {
        return `${fieldName}: incomplete range. Use format "N..M" for ranges.`;
    }

    // Reject multiple dots
    if ((trimmed.match(/\./g) || []).length > 1) {
        return `${fieldName}: invalid format. Use single value or "N..M" range.`;
    }

    // Try single integer (strict: reject decimals and mixed text like "50x")
    if (!/^-?\d+$/.test(trimmed)) {
        return `${fieldName}: must be a whole number or range (e.g., "50" or "30..70").`;
    }
    const n = parseInt(trimmed, 10);
    if (n < min || n > max) {
        return `${fieldName}: must be between ${min} and ${max} (got ${n}).`;
    }

    return null;
}

export interface CanvasGeneratorInputValidationParams {
    width: string;
    height: string;
    cellSize: string;
    obstacleRatio: string;
    clusteringProb: string;
    hasObsLeftField: boolean;
    hasClustLeftField: boolean;
}

export interface CanvasGeneratorInputValidationResult {
    isRequiredFieldsValid: boolean;
    cellSizeFitError: string | null;
    obstacleRatioError: string | null;
    clusteringError: string | null;
    hasAnyRangeFieldError: boolean;
    canGenerate: boolean;
}

function shouldHideIncompleteError(raw: string, hasLeftField: boolean): boolean {
    const trimmed = raw.trim();
    if (trimmed === "") return false;
    return !hasLeftField && (trimmed.endsWith(".") || trimmed.endsWith(".."));
}

export function validateCanvasGeneratorInputs(
    params: CanvasGeneratorInputValidationParams,
): CanvasGeneratorInputValidationResult {
    const {
        width,
        height,
        cellSize,
        obstacleRatio,
        clusteringProb,
        hasObsLeftField,
        hasClustLeftField,
    } = params;

    const w = parseFloat(width);
    const h = parseFloat(height);
    const cs = parseFloat(cellSize);

    const isRequiredFieldsValid = isFinite(w) && w > 0 && isFinite(h) && h > 0 && isFinite(cs) && cs > 0;
    const cellSizeFitError = validateCellSizeFit(w, h, cs);

    const obstacleErr = validateRangeField(obstacleRatio, "Obstacle ratio", 0, 100);
    const obstacleRatioError = obstacleErr !== null && shouldHideIncompleteError(obstacleRatio, hasObsLeftField)
        ? null
        : obstacleErr;

    const clusteringErr = validateRangeField(clusteringProb, "Clustering", 0, 100);
    const clusteringError = clusteringErr !== null && shouldHideIncompleteError(clusteringProb, hasClustLeftField)
        ? null
        : clusteringErr;

    const hasAnyRangeFieldError = obstacleRatioError !== null || clusteringError !== null;
    const canGenerate = isRequiredFieldsValid && cellSizeFitError === null && !hasAnyRangeFieldError;

    return {
        isRequiredFieldsValid,
        cellSizeFitError,
        obstacleRatioError,
        clusteringError,
        hasAnyRangeFieldError,
        canGenerate,
    };
}
