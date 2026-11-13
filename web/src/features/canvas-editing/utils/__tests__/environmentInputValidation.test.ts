import { describe, expect, test } from "bun:test";
import {
    validateCellSizeFit,
    validateRangeField,
} from "@/features/canvas-editing/utils/environmentInputValidation";

describe("validateCellSizeFit - cell size fit validation", () => {
    test("returns null when width or height are not present/invalid", () => {
        expect(validateCellSizeFit(0, 1000, 20)).toBeNull();
        expect(validateCellSizeFit(-100, 1000, 20)).toBeNull();
        expect(validateCellSizeFit(NaN, 1000, 20)).toBeNull();
        expect(validateCellSizeFit(1000, 0, 20)).toBeNull();
        expect(validateCellSizeFit(1000, -100, 20)).toBeNull();
        expect(validateCellSizeFit(1000, NaN, 20)).toBeNull();
    });

    test("returns null when cell size is not present/invalid", () => {
        expect(validateCellSizeFit(1000, 1000, 0)).toBeNull();
        expect(validateCellSizeFit(1000, 1000, -10)).toBeNull();
        expect(validateCellSizeFit(1000, 1000, NaN)).toBeNull();
    });

    test("returns null for perfectly divisible dimensions with 2x2+ grid", () => {
        expect(validateCellSizeFit(40, 40, 20)).toBeNull(); // 2x2 grid
        expect(validateCellSizeFit(40, 80, 20)).toBeNull(); // 2x4 grid
        expect(validateCellSizeFit(80, 40, 20)).toBeNull(); // 4x2 grid
        expect(validateCellSizeFit(100, 100, 25)).toBeNull(); // 4x4 grid
        expect(validateCellSizeFit(600, 600, 30)).toBeNull(); // 20x20 grid
    });

    test("returns divisibility error when width is not a multiple of cell size", () => {
        const result = validateCellSizeFit(50, 40, 20);
        expect(result).toBeTruthy();
        expect(result).toContain("evenly");
    });

    test("returns divisibility error when height is not a multiple of cell size", () => {
        const result = validateCellSizeFit(40, 50, 20);
        expect(result).toBeTruthy();
        expect(result).toContain("evenly");
    });

    test("returns divisibility error when both are not multiples", () => {
        const result = validateCellSizeFit(50, 50, 20);
        expect(result).toBeTruthy();
        expect(result).toContain("evenly");
    });

    test("returns grid size error when cell is too large (1x1 grid)", () => {
        const result = validateCellSizeFit(100, 100, 100);
        expect(result).toBeTruthy();
        expect(result).toContain("at least 2");
    });

    test("returns grid size error when cell is too large (1x2 grid)", () => {
        const result = validateCellSizeFit(40, 80, 40);
        expect(result).toBeTruthy();
        expect(result).toContain("at least 2");
    });

    test("returns grid size error when cell is too large (2x1 grid)", () => {
        const result = validateCellSizeFit(80, 40, 40);
        expect(result).toBeTruthy();
        expect(result).toContain("at least 2");
    });

    test("tolerates small floating-point errors in divisibility", () => {
        // 40 / 20 = 2 exactly, but due to float representation might be 1.9999999
        expect(validateCellSizeFit(40.0000000001, 40, 20)).toBeNull();
        expect(validateCellSizeFit(40, 40.0000000001, 20)).toBeNull();
    });

    test("rejects non-trivial remainder beyond tolerance", () => {
        expect(validateCellSizeFit(40.1, 40, 20)).toBeTruthy();
        expect(validateCellSizeFit(40, 40.1, 20)).toBeTruthy();
    });

    test("returns null at exact 2x2 boundary (smallest valid grid)", () => {
        // 40 / 20 = 2 cells on each axis (valid)
        expect(validateCellSizeFit(40, 40, 20)).toBeNull();
    });

    test("returns null when exactly 2x2+ cells exist", () => {
        // 50 cells × 50 cells ÷ 25 cells per side = 2×2 grid (edge case that should be invalid due to divisibility)
        // But 50 ÷ 25 = 2 exactly, so this is valid
        expect(validateCellSizeFit(50, 50, 25)).toBeNull();
    });
});

describe("validateRangeField - range field validation", () => {
    test("returns null for empty string (auto-derive)", () => {
        expect(validateRangeField("", "Test field")).toBeNull();
        expect(validateRangeField("  ", "Test field")).toBeNull();
    });

    test("returns null for valid single integer within range", () => {
        expect(validateRangeField("0", "Obstacle ratio")).toBeNull();
        expect(validateRangeField("50", "Clustering")).toBeNull();
        expect(validateRangeField("100", "Obstacle ratio")).toBeNull();
    });

    test("returns null for valid range format N..M within bounds", () => {
        expect(validateRangeField("30..70", "Obstacle ratio")).toBeNull();
        expect(validateRangeField("0..100", "Clustering")).toBeNull();
        expect(validateRangeField("10..20", "Test field")).toBeNull();
    });

    test("returns null for reversed range (min > max) — will be auto-swapped on blur", () => {
        expect(validateRangeField("70..30", "Obstacle ratio")).toBeNull();
        expect(validateRangeField("100..0", "Clustering")).toBeNull();
    });

    test("returns null for single value at boundaries", () => {
        expect(validateRangeField("0", "Test")).toBeNull();
        expect(validateRangeField("100", "Test")).toBeNull();
    });

    test("returns null for range with boundary values", () => {
        expect(validateRangeField("0..0", "Test")).toBeNull();
        expect(validateRangeField("100..100", "Test")).toBeNull();
        expect(validateRangeField("0..100", "Test")).toBeNull();
    });

    test("returns error for single value below min", () => {
        const err = validateRangeField("-1", "Obstacle ratio");
        expect(err).toBeTruthy();
        expect(err).toContain("between 0 and 100");
    });

    test("returns error for single value above max", () => {
        const err = validateRangeField("101", "Clustering");
        expect(err).toBeTruthy();
        expect(err).toContain("between 0 and 100");
    });

    test("returns error for range with value below min", () => {
        const err = validateRangeField("-5..50", "Obstacle ratio");
        expect(err).toBeTruthy();
        expect(err).toContain("first value");
    });

    test("returns error for range with value above max", () => {
        const err = validateRangeField("50..150", "Clustering");
        expect(err).toBeTruthy();
        expect(err).toContain("second value");
    });

    test("returns error for incomplete range ending with dot", () => {
        const err = validateRangeField("30.", "Test field");
        expect(err).toBeTruthy();
        expect(err).toContain("incomplete");
    });

    test("returns error for incomplete range ending with dots", () => {
        const err = validateRangeField("30..", "Test field");
        expect(err).toBeTruthy();
        expect(err).toContain("incomplete");
    });

    test("returns error for leading dots without value", () => {
        const err = validateRangeField("..50", "Test field");
        expect(err).toBeTruthy();
    });

    test("returns error for multiple dot separators", () => {
        const err = validateRangeField("30..50..70", "Obstacle ratio");
        expect(err).toBeTruthy();
        expect(err).toContain("invalid format");
    });

    test("returns error for decimal values", () => {
        const err = validateRangeField("30.5", "Test field");
        expect(err).toBeTruthy();
        expect(err).toContain("whole number");
    });

    test("returns error for non-numeric input", () => {
        const err = validateRangeField("abc", "Test field");
        expect(err).toBeTruthy();
        expect(err).toContain("whole number");
    });

    test("returns error for mixed numeric/text", () => {
        const err = validateRangeField("50x", "Test field");
        expect(err).toBeTruthy();
    });

    test("returns error for single dot", () => {
        const err = validateRangeField(".", "Test field");
        expect(err).toBeTruthy();
    });

    test("returns error for double dots only", () => {
        const err = validateRangeField("..", "Test field");
        expect(err).toBeTruthy();
    });

    test("includes field name in error messages", () => {
        const err1 = validateRangeField("150", "Obstacle ratio");
        expect(err1).toContain("Obstacle ratio");
        const err2 = validateRangeField("999", "Clustering");
        expect(err2).toContain("Clustering");
    });

    test("respects custom min/max bounds", () => {
        expect(validateRangeField("5", "Custom", 10, 20)).toBeTruthy();
        expect(validateRangeField("15", "Custom", 10, 20)).toBeNull();
        expect(validateRangeField("25", "Custom", 10, 20)).toBeTruthy();
    });

    test("handles whitespace in range format", () => {
        // Trimmed spaces should not affect single value parsing
        expect(validateRangeField("  50  ", "Test")).toBeNull();
        // But spaces within range format break it (not a valid match)
        const err = validateRangeField("  30 .. 70  ", "Test");
        expect(err).toBeTruthy();
    });
});
