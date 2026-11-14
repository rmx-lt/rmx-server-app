import { useMemo, useLayoutEffect, useRef } from "react";
import { Image } from "react-konva";
import type Konva from "konva";

const BASE_LABEL_W = 60;
const BASE_LABEL_H = 20;
const BASE_FONT_SIZE = 12;
// Baseline vertex radius (matches the Math.max(6, …) floor in CanvasVertexHandlesLayer)
const BASE_VERTEX_RADIUS = 6;

function contrastColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 0.5 ? "#000000" : "#ffffff";
}

interface CanvasVertexIdLabelProps {
    index: number;
    x: number;
    y: number;
    scale: number;
    edgeWidth: number;
    accentColor: string;
}

// Pre-render the label to an offscreen HTMLCanvasElement so every Konva frame
// is a single ctx.drawImage() blit instead of running the text pipeline.
// The offscreen canvas is only redrawn when id, colors, or size actually change.
export function CanvasVertexIdLabel({ index, x, y, scale, edgeWidth, accentColor }: CanvasVertexIdLabelProps) {
    const labelFill = contrastColor(accentColor);
    const labelStroke = labelFill === "#000000" ? "#ffffff" : "#000000";
    const imageRef = useRef<Konva.Image>(null);

    // Mirror the vertex radius formula so the label scales identically to the vertex circle
    const screenFactor = Math.max(BASE_VERTEX_RADIUS, edgeWidth * 1.5) / BASE_VERTEX_RADIUS;
    const canvasW = Math.round(BASE_LABEL_W * screenFactor);
    const canvasH = Math.round(BASE_LABEL_H * screenFactor);
    const fontSize = Math.round(BASE_FONT_SIZE * screenFactor);

    // Re-create the offscreen canvas only when its pixel dimensions change
    const offscreen = useMemo<HTMLCanvasElement>(() => {
        const c = document.createElement("canvas");
        const dpr = window.devicePixelRatio || 1;
        c.width = canvasW * dpr;
        c.height = canvasH * dpr;
        return c;
         
    }, [canvasW, canvasH]);

    useLayoutEffect(() => {
        const dpr = window.devicePixelRatio || 1;
        const ctx = offscreen.getContext("2d")!;
        ctx.clearRect(0, 0, offscreen.width, offscreen.height);
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Nudge text down slightly: textBaseline "middle" sits a bit above the true visual
        // center for most fonts; 0.1 × fontSize corrects the optical offset.
        const textY = canvasH / 2 + fontSize * 0.08;
        ctx.strokeStyle = labelStroke;
        ctx.lineWidth = 2 * screenFactor;
        ctx.strokeText(String(index), canvasW / 2, textY);
        ctx.fillStyle = labelFill;
        ctx.fillText(String(index), canvasW / 2, textY);
        ctx.restore();
        // Signal the layer to pick up the new canvas content on next draw
        imageRef.current?.getLayer()?.batchDraw();
    }, [index, labelFill, labelStroke, offscreen, fontSize, canvasW, canvasH]);

    return (
        <Image
            ref={imageRef}
            image={offscreen}
            x={x}
            y={y}
            width={canvasW / scale}
            height={canvasH / scale}
            offsetX={canvasW / (2 * scale)}
            offsetY={canvasH / (2 * scale)}
            listening={false}
            perfectDrawEnabled={false}
        />
    );
}
