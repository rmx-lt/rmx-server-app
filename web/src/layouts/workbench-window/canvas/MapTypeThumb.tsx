import type { MapLayer } from "@/model/mapLayerStore";
import satellite from "@/assets/map-type-satellite.jpg";
import street from "@/assets/map-type-street.jpg";

// One real tile of each service, bundled: no request at run time. They show a public park and a city centre.
const SAMPLE = { satellite, street };
const GRID_LINES = [8, 16, 24, 32, 40, 48];

/** Small pictures of the map types: a sample of the real map, or the grid drawn in the colours of the theme. */
export default function MapTypeThumb({ type }: { type: MapLayer }) {
    if (type !== "empty") return <img src={SAMPLE[type]} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />;
    return (
        <svg viewBox="0 0 56 56" preserveAspectRatio="xMidYMid slice" aria-hidden className="absolute inset-0 h-full w-full">
            <rect width="56" height="56" style={{ fill: "var(--color-page)" }} />
            {GRID_LINES.map((p) => (
                <path key={p} d={`M${p} 0v56M0 ${p}h56`} style={{ stroke: "var(--color-canvas-grid)" }} strokeWidth={p === 24 ? 1.5 : 1} opacity={p === 24 ? 1 : 0.6} />
            ))}
        </svg>
    );
}
