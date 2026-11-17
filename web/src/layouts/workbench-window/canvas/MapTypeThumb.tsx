import type { MapLayer } from "@/model/mapLayerStore";

const GRID_LINES = [8, 16, 24, 32, 40, 48];
const TREES = [[10, 12], [16, 20], [8, 24], [38, 36], [46, 44], [32, 46], [44, 30], [14, 44], [48, 10]];

/** Small inline pictures of the map types: no tile request, works offline. Grid follows the theme. */
export default function MapTypeThumb({ type }: { type: MapLayer }) {
    return (
        <svg viewBox="0 0 56 56" preserveAspectRatio="xMidYMid slice" aria-hidden className="absolute inset-0 h-full w-full">
            {type === "satellite" && (
                <>
                    <rect width="56" height="56" fill="#4c6a3a" />
                    <path d="M0 0h26l-8 30H0z" fill="#6f8a45" />
                    <path d="M26 0h30v22H20z" fill="#8c7a4a" />
                    <path d="M0 30h18l6 26H0z" fill="#9a8556" />
                    <path d="M18 30l38-8v34H24z" fill="#3b5a2f" />
                    {TREES.map(([x, y]) => (
                        <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" fill="#2c4724" opacity="0.85" />
                    ))}
                </>
            )}
            {type === "street" && (
                <>
                    <rect width="56" height="56" fill="#efece4" />
                    <rect x="34" y="34" width="22" height="22" fill="#aacbe8" />
                    <rect x="2" y="36" width="20" height="18" rx="3" fill="#c5e0b4" />
                    <path d="M0 22h56M24 0v56" stroke="#ffffff" strokeWidth="5" />
                    <path d="M0 22h56M24 0v56" stroke="#d9a441" strokeWidth="1.5" />
                    <path d="M0 46l34-14M40 0l16 20" stroke="#ffffff" strokeWidth="3" />
                </>
            )}
            {type === "empty" && (
                <>
                    <rect width="56" height="56" style={{ fill: "var(--color-page)" }} />
                    {GRID_LINES.map((p) => (
                        <path key={p} d={`M${p} 0v56M0 ${p}h56`} style={{ stroke: "var(--color-canvas-grid)" }} strokeWidth={p === 24 ? 1.5 : 1} opacity={p === 24 ? 1 : 0.6} />
                    ))}
                </>
            )}
        </svg>
    );
}
