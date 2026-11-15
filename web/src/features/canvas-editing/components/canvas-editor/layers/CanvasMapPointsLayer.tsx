import { memo, useState } from "react";
import { Layer, Circle } from "react-konva";
import { useMapPointStore } from "@/model/mapPointStore";
import { useMapStore } from "@/model/mapStore";
import { useLayerSettingsStore, getLayerParam } from "@/model/layerSettingsStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { LAYER_ID, LAYER_PARAM_KEY } from "@/data/planning/layerRegistry";
import type { MapPointType } from "@/data/planning/schemaTypes";

export const CanvasMapPointsLayer = memo(function CanvasMapPointsLayer({
    onMapPointHoverChange,
}: {
    onMapPointHoverChange: (hovering: boolean) => void;
}) {
    const startPoint = useMapPointStore((s) => s.startPoint);
    const endPoint = useMapPointStore((s) => s.endPoint);
    const startEndPoint = useMapPointStore((s) => s.startEndPoint);
    const movePointLive = useMapPointStore((s) => s.movePointLive);
    const upsertPoint = useMapPointStore((s) => s.upsertPoint);
    const mapId = useMapStore((s) => s.map.id);
    const layerSettings = useLayerSettingsStore((s) => s.layers);
    const { activeTool } = useCanvasToolStore();
    const scale = useCanvasViewStore((s) => s.scale);
    const selectedMapPointType = useCanvasSelectionStore((s) => s.selectedMapPointType);
    const selectMapPoint = useCanvasSelectionStore((s) => s.selectMapPoint);

    const [draggingType, setDraggingType] = useState<MapPointType | null>(null);

    const visible = getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.VISIBLE) !== "false";

    const startFill = getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.START_POINT_COLOR) ?? "#22c55e";
    const startRadius = parseFloat(getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.START_POINT_RADIUS) ?? "8");
    const startStroke = getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.START_POINT_STROKE_COLOR) ?? "#166534";

    const endFill = getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.END_POINT_COLOR) ?? "#ef4444";
    const endRadius = parseFloat(getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.END_POINT_RADIUS) ?? "8");
    const endStroke = getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.END_POINT_STROKE_COLOR) ?? "#991b1b";

    const startEndFill = getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.START_END_POINT_COLOR) ?? "#a855f7";
    const startEndRadius = parseFloat(getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.START_END_POINT_RADIUS) ?? "8");
    const startEndStroke = getLayerParam(layerSettings, LAYER_ID.MAP_POINTS, LAYER_PARAM_KEY.START_END_POINT_STROKE_COLOR) ?? "#6b21a8";

    if (!visible) return null;

    const isSelectMode = activeTool === "select";
    const startActive = selectedMapPointType === "start" || draggingType === "start";
    const endActive = selectedMapPointType === "end" || draggingType === "end";
    const startEndActive = selectedMapPointType === "start_end" || draggingType === "start_end";
    const pointStrokeWidth = 1.5 / scale;
    const pointHitStrokeWidth = 10 / scale;
    const pointShadowBlur = 12 / scale;
    const pointShadowOffsetY = 3 / scale;

    return (
        <Layer>
            {startPoint && (
                <Circle
                    x={startPoint.point.x}
                    y={startPoint.point.y}
                    radius={(startActive ? startRadius * 1.4 : startRadius) / scale}
                    fill={startFill}
                    stroke={startStroke}
                    strokeWidth={pointStrokeWidth}
                    hitStrokeWidth={pointHitStrokeWidth}
                    shadowEnabled={startActive}
                    shadowColor="rgba(0,0,0,0.6)"
                    shadowBlur={pointShadowBlur}
                    shadowOffsetX={0}
                    shadowOffsetY={pointShadowOffsetY}
                    listening={isSelectMode}
                    draggable={isSelectMode}
                    perfectDrawEnabled={startActive}
                    onMouseEnter={() => isSelectMode && onMapPointHoverChange(true)}
                    onMouseLeave={() => onMapPointHoverChange(false)}
                    onClick={(e) => {
                        e.cancelBubble = true;
                        selectMapPoint("start");
                    }}
                    onDragStart={() => {
                        setDraggingType("start");
                        selectMapPoint("start");
                    }}
                    onDragEnd={(e) => {
                        setDraggingType(null);
                        upsertPoint(mapId, "start", { x: e.target.x(), y: e.target.y() });
                        selectMapPoint("start");
                    }}
                    onDragMove={(e) => {
                        movePointLive(mapId, "start", { x: e.target.x(), y: e.target.y() });
                    }}
                />
            )}
            {endPoint && (
                <Circle
                    x={endPoint.point.x}
                    y={endPoint.point.y}
                    radius={(endActive ? endRadius * 1.4 : endRadius) / scale}
                    fill={endFill}
                    stroke={endStroke}
                    strokeWidth={pointStrokeWidth}
                    hitStrokeWidth={pointHitStrokeWidth}
                    shadowEnabled={endActive}
                    shadowColor="rgba(0,0,0,0.6)"
                    shadowBlur={pointShadowBlur}
                    shadowOffsetX={0}
                    shadowOffsetY={pointShadowOffsetY}
                    listening={isSelectMode}
                    draggable={isSelectMode}
                    perfectDrawEnabled={endActive}
                    onMouseEnter={() => isSelectMode && onMapPointHoverChange(true)}
                    onMouseLeave={() => onMapPointHoverChange(false)}
                    onClick={(e) => {
                        e.cancelBubble = true;
                        selectMapPoint("end");
                    }}
                    onDragStart={() => {
                        setDraggingType("end");
                        selectMapPoint("end");
                    }}
                    onDragEnd={(e) => {
                        setDraggingType(null);
                        upsertPoint(mapId, "end", { x: e.target.x(), y: e.target.y() });
                        selectMapPoint("end");
                    }}
                    onDragMove={(e) => {
                        movePointLive(mapId, "end", { x: e.target.x(), y: e.target.y() });
                    }}
                />
            )}
            {startEndPoint && (
                <Circle
                    x={startEndPoint.point.x}
                    y={startEndPoint.point.y}
                    radius={(startEndActive ? startEndRadius * 1.4 : startEndRadius) / scale}
                    fill={startEndFill}
                    stroke={startEndStroke}
                    strokeWidth={pointStrokeWidth}
                    hitStrokeWidth={pointHitStrokeWidth}
                    shadowEnabled={startEndActive}
                    shadowColor="rgba(0,0,0,0.6)"
                    shadowBlur={pointShadowBlur}
                    shadowOffsetX={0}
                    shadowOffsetY={pointShadowOffsetY}
                    listening={isSelectMode}
                    draggable={isSelectMode}
                    perfectDrawEnabled={startEndActive}
                    onMouseEnter={() => isSelectMode && onMapPointHoverChange(true)}
                    onMouseLeave={() => onMapPointHoverChange(false)}
                    onClick={(e) => {
                        e.cancelBubble = true;
                        selectMapPoint("start_end");
                    }}
                    onDragStart={() => {
                        setDraggingType("start_end");
                        selectMapPoint("start_end");
                    }}
                    onDragEnd={(e) => {
                        setDraggingType(null);
                        upsertPoint(mapId, "start_end", { x: e.target.x(), y: e.target.y() });
                        selectMapPoint("start_end");
                    }}
                    onDragMove={(e) => {
                        movePointLive(mapId, "start_end", { x: e.target.x(), y: e.target.y() });
                    }}
                />
            )}
        </Layer>
    );
});
