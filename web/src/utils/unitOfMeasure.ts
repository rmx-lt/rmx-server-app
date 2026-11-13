export type UnitOfMeasure = "none" | "cm" | "m" | "km";

export const DEFAULT_UNIT_OF_MEASURE: UnitOfMeasure = "cm";

const METERS_PER_UNIT: Record<Exclude<UnitOfMeasure, "none">, number> = {
    cm: 0.01,
    m: 1,
    km: 1000,
};

const AUTO_SCALE_MIN_METERS = 1;
const AUTO_SCALE_MAX_METERS = 1000;

export function unitLabel(unit: UnitOfMeasure): string {
    return unit === "none" ? "" : unit;
}

export function areaUnitLabel(unit: UnitOfMeasure): string {
    return unit === "none" ? "" : `${unit}²`;
}

export function convertLinearFromBase(baseValue: number, unit: UnitOfMeasure): number {
    if (unit === "none") return baseValue;
    return baseValue / METERS_PER_UNIT[unit];
}

export function convertLinearToBase(unitValue: number, unit: UnitOfMeasure): number {
    if (unit === "none") return unitValue;
    return unitValue * METERS_PER_UNIT[unit];
}

export function convertAreaFromBase(baseAreaValue: number, unit: UnitOfMeasure): number {
    if (unit === "none") return baseAreaValue;
    const factor = METERS_PER_UNIT[unit] ** 2;
    return baseAreaValue / factor;
}

export function convertAreaToBase(unitAreaValue: number, unit: UnitOfMeasure): number {
    if (unit === "none") return unitAreaValue;
    const factor = METERS_PER_UNIT[unit] ** 2;
    return unitAreaValue * factor;
}

const UNIT_ORDER: Array<Exclude<UnitOfMeasure, "none">> = ["cm", "m", "km"];

export function pickAutoLinearUnit(valueInSelectedUnit: number, selectedUnit: UnitOfMeasure): UnitOfMeasure {
    if (selectedUnit === "none") return "none";

    // Convert to meters to apply thresholds
    const valueInMeters = Math.abs(valueInSelectedUnit) * METERS_PER_UNIT[selectedUnit];

    let autoUnit: Exclude<UnitOfMeasure, "none">;
    if (valueInMeters >= AUTO_SCALE_MAX_METERS) autoUnit = "km";
    else if (valueInMeters >= AUTO_SCALE_MIN_METERS) autoUnit = "m";
    else autoUnit = "cm";

    // Never scale down below the selected unit
    const selectedIdx = UNIT_ORDER.indexOf(selectedUnit);
    const autoIdx = UNIT_ORDER.indexOf(autoUnit);
    return autoIdx >= selectedIdx ? autoUnit : selectedUnit;
}

export function pickAutoAreaUnit(areaValueInSelectedUnit: number, selectedUnit: UnitOfMeasure): UnitOfMeasure {
    if (selectedUnit === "none") return "none";

    const derivedLinear = Math.sqrt(Math.abs(areaValueInSelectedUnit));
    return pickAutoLinearUnit(derivedLinear, selectedUnit);
}

/** Convert a value directly between two units (no intermediate "base" needed). */
export function convertLinear(value: number, from: UnitOfMeasure, to: UnitOfMeasure): number {
    if (from === "none" || to === "none" || from === to) return value;
    return (value * METERS_PER_UNIT[from]) / METERS_PER_UNIT[to];
}

/** Convert an area value directly between two units. */
export function convertArea(value: number, from: UnitOfMeasure, to: UnitOfMeasure): number {
    if (from === "none" || to === "none" || from === to) return value;
    return (value * METERS_PER_UNIT[from] ** 2) / METERS_PER_UNIT[to] ** 2;
}

export function formatNumber(value: number, maximumFractionDigits: number): string {
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits,
    }).format(value);
}
