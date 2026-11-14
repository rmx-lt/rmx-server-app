import MapPreview from "./MapPreview";
import type { Point } from "@/utils/geometry";

export interface MapPreviewItem {
    /** 0-based index; label renders as "Scenarijus {id + 1}" */
    id: number;
    boundary: Point[];
    noGoZones: Point[][];
    /** Hex seed string used during generation. Shown below the canvas when provided. */
    seedHex?: string;
}

interface MapPreviewGroupProps {
    maps: MapPreviewItem[];
    /** Canvas side length in px for each preview. Default: 80 */
    size?: number;
}

export default function MapPreviewGroup({ maps, size = 110 }: MapPreviewGroupProps) {
    if (maps.length === 0) {
        return (
            <p className="text-xs text-gray-400 italic">Maps not generated.</p>
        );
    }

    return (
        <div className="flex flex-wrap gap-2 justify-center">
            {maps.map((map) => (
                <MapPreview
                    key={map.id}
                    id={map.id}
                    boundary={map.boundary}
                    noGoZones={map.noGoZones}
                    size={size}
                />
            ))}
        </div>
    );
}
