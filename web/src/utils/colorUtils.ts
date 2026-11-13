/** Returns an active/selected fill shade — darker for light fills, lighter for dark fills. */
export function deriveActiveFill(hex: string): string {
    if (hex.length !== 7) return "#cbd5e1";
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const target = luminance > 0.5 ? 0 : 255;
    return `#${[r, g, b].map((c) => Math.round(c * 0.85 + target * 0.15).toString(16).padStart(2, "0")).join("")}`;
}
