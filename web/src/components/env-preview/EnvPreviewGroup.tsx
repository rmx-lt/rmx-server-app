import EnvPreview from "./EnvPreview";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";

export interface EnvPreviewItem {
    /** 0-based index; label renders as "Scenarijus {id + 1}" */
    id: number;
    boundary: Point[];
    obstacles: Point[][];
    /** Hex seed string used during generation. Shown below the canvas when provided. */
    seedHex?: string;
}

interface EnvPreviewGroupProps {
    environments: EnvPreviewItem[];
    /** Canvas side length in px for each preview. Default: 80 */
    size?: number;
}

export default function EnvPreviewGroup({ environments, size = 110 }: EnvPreviewGroupProps) {
    if (environments.length === 0) {
        return (
            <p className="text-xs text-gray-400 italic">Environments not generated.</p>
        );
    }

    return (
        <div className="flex flex-wrap gap-2 justify-center">
            {environments.map((env) => (
                <EnvPreview
                    key={env.id}
                    id={env.id}
                    boundary={env.boundary}
                    obstacles={env.obstacles}
                    size={size}
                />
            ))}
        </div>
    );
}
