import { useEffect, useRef } from "react";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";

interface EnvPreviewProps {
    /** 0-based index; label renders as "Scenarijus {id + 1}" */
    id: number;
    boundary: Point[];
    obstacles: Point[][];
    /** Canvas side length in px. Default: 120 */
    size?: number;
    /** Hex seed used during generation. Displayed below the canvas when provided. */
    seedHex?: string;
}

export default function EnvPreview({ id, boundary, obstacles, size = 120, seedHex }: EnvPreviewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Fill everything black (empty / out-of-boundary)
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, size, size);

        if (boundary.length < 3) return;

        // Compute bounding box across boundary vertices
        let minX = boundary[0]!.x;
        let maxX = boundary[0]!.x;
        let minY = boundary[0]!.y;
        let maxY = boundary[0]!.y;
        for (const p of boundary) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

        const padding = 4;
        const drawSize = size - padding * 2;
        const dataW = maxX - minX || 1;
        const dataH = maxY - minY || 1;
        const scale = Math.min(drawSize / dataW, drawSize / dataH);

        // Center the scaled geometry
        const offsetX = padding + (drawSize - dataW * scale) / 2;
        const offsetY = padding + (drawSize - dataH * scale) / 2;

        const toCanvas = (p: Point) => ({
            x: offsetX + (p.x - minX) * scale,
            y: offsetY + (p.y - minY) * scale,
        });

        // Draw boundary zone as white
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        const b0 = toCanvas(boundary[0]!);
        ctx.moveTo(b0.x, b0.y);
        for (let i = 1; i < boundary.length; i++) {
            const bp = toCanvas(boundary[i]!);
            ctx.lineTo(bp.x, bp.y);
        }
        ctx.closePath();
        ctx.fill();

        // Draw each obstacle as black (punches back to black)
        ctx.fillStyle = "#000000";
        for (const obstacle of obstacles) {
            if (obstacle.length < 3) continue;
            ctx.beginPath();
            const o0 = toCanvas(obstacle[0]!);
            ctx.moveTo(o0.x, o0.y);
            for (let i = 1; i < obstacle.length; i++) {
                const op = toCanvas(obstacle[i]!);
                ctx.lineTo(op.x, op.y);
            }
            ctx.closePath();
            ctx.fill();
        }
    }, [boundary, obstacles, size]);

    return (
        <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-bold text-gray-900">Scenarijus {id + 1}</span>
            <div className="border-2 border-white">
                <canvas ref={canvasRef} width={size} height={size} />
            </div>
            {seedHex && (
                <span className="text-[10px] font-mono text-gray-400 leading-none">{seedHex}</span>
            )}
        </div>
    );
}
