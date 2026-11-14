import { Circle, Rect, RegularPolygon, Shape } from "react-konva";

export interface MarkerShapeProps {
    shape: string;
    radius: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    dash?: number[];
    listening?: boolean;
    perfectDrawEnabled?: boolean;
}

/**
 * Renders a single point marker shape centered at (0, 0).
 * Intended to be placed inside a Konva <Group> that handles positioning.
 *
 * Supports: circle, square, triangle, diamond, cross.
 * Falls back to circle for unrecognised shape values.
 */
export function MarkerShape({
    shape: shapeType,
    radius,
    fill,
    stroke,
    strokeWidth,
    dash,
    listening,
    perfectDrawEnabled,
}: MarkerShapeProps) {
    const commonProps = { fill, stroke, strokeWidth, dash, listening, perfectDrawEnabled };
    switch (shapeType) {
        case "square":
            return (
                <Rect
                    {...commonProps}
                    x={-radius}
                    y={-radius}
                    width={radius * 2}
                    height={radius * 2}
                />
            );
        case "triangle":
            return <RegularPolygon {...commonProps} sides={3} radius={radius} />;
        case "diamond":
            return <RegularPolygon {...commonProps} sides={4} radius={radius} />;
        case "cross": {
            const aw = radius * 0.2;
            const al = radius;
            return (
                <Shape
                    {...commonProps}
                    rotation={45}
                    sceneFunc={(ctx, s) => {
                        ctx.beginPath();
                        ctx.moveTo(-aw, -al);
                        ctx.lineTo(aw, -al);
                        ctx.lineTo(aw, -aw);
                        ctx.lineTo(al, -aw);
                        ctx.lineTo(al, aw);
                        ctx.lineTo(aw, aw);
                        ctx.lineTo(aw, al);
                        ctx.lineTo(-aw, al);
                        ctx.lineTo(-aw, aw);
                        ctx.lineTo(-al, aw);
                        ctx.lineTo(-al, -aw);
                        ctx.lineTo(-aw, -aw);
                        ctx.closePath();
                        ctx.fillStrokeShape(s);
                    }}
                />
            );
        }
        case "circle":
        default:
            return <Circle {...commonProps} radius={radius} />;
    }
}
