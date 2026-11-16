import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage } from "react-konva";
import type Konva from "konva";
import type { Area } from "@/data/planning/schemaTypes";
import type { VertexRef } from "@/features/canvas-editing/types/canvas";
import { sameObject } from "@/features/canvas-editing/utils/canvasObjectUtils";
import { useCanvasViewStore } from "@/features/canvas-editing/stores/canvasViewStore";
import { useCanvasToolStore } from "@/features/canvas-editing/stores/canvasToolStore";
import { useCanvasObjectStore } from "@/features/canvas-editing/stores/canvasObjectStore";
import { beginBatch, endBatch } from "@/features/canvas-editing/stores/canvasHistoryStore";
import { useCanvasSelectionStore } from "@/features/canvas-editing/stores/canvasSelectionStore";
import { useCanvasSize } from "@/features/canvas-editing/hooks/canvas-editor/useCanvasSize";
import type { Point } from "@/features/canvas-editing/utils/canvasGeometry";
import { useCanvasPanning } from "@/features/canvas-editing/hooks/canvas-editor/useCanvasPanning";
import { useCanvasZoom } from "@/features/canvas-editing/hooks/canvas-editor/useCanvasZoom";
import { AREA_CATEGORY } from "@/config/db-ops/enums";
import { isLayerVisible } from "@/config/modes/modes";
import { useModeStore } from "@/model/modeStore";
import { useCanvasDrawing } from "@/features/canvas-editing/hooks/canvas-editor/useCanvasDrawing";
import { useCanvasMidpointDrag } from "@/features/canvas-editing/hooks/canvas-editor/useCanvasMidpointDrag";
import { useCanvasVertexDrag } from "@/features/canvas-editing/hooks/canvas-editor/useCanvasVertexDrag";
import { useCanvasKeyboard } from "@/features/canvas-editing/hooks/canvas-editor/useCanvasKeyboard";
import { useCanvasAutosave } from "@/features/canvas-editing/hooks/canvas-editor/useCanvasSave";
import { CanvasGridLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasGridLayer";
import { CanvasPolygonObjectsLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasPolygonObjectsLayer";
import { CanvasVertexHandlesLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasVertexHandlesLayer";
import { CanvasDrawingPreviewLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasDrawingPreviewLayer";
import { CanvasMapTileLayer } from "@/features/canvas-editing/components/canvas-editor/layers/CanvasMapTileLayer";

export default function CanvasEditor() {
  const stageRef = useRef<Konva.Stage>(null);
  const [draggingVertexRef, setDraggingVertexRef] = useState<VertexRef | null>(null);
  const [movingObject, setMovingObject] = useState<Area | null>(null);
  const [isHoveringHandle, setIsHoveringHandle] = useState(false);
  const [isHoveringObject, setIsHoveringObject] = useState<Area | null>(null);
  const centeredRef = useRef(false);

  const areasVisible = isLayerVisible(useModeStore((s) => s.mode), "areas");
  const scale = useCanvasViewStore((s) => s.scale);
  const position = useCanvasViewStore((s) => s.position);
  const setPosition = useCanvasViewStore((s) => s.setPosition);
  const setCanvasSize = useCanvasViewStore((s) => s.setCanvasSize);
  const { activeTool, setActiveTool } = useCanvasToolStore();
  const {
    objects,
    addObject,
    deleteObject,
    moveVertexAt,
    finalizeVertexMoveAt,
    moveObject,
    deleteVertex,
    deleteVertices,
    insertVertex,
  } = useCanvasObjectStore();

  const {
    selectedObject: selectedStoreObject,
    selectedVertexRefs,
    selectObject,
    clearSelection,
    selectVertex,
    toggleVertexSelection,
  } = useCanvasSelectionStore();

  const { containerRef, size } = useCanvasSize();

  useEffect(() => {
    if (size.width > 0 && size.height > 0) {
      setCanvasSize(size.width, size.height);
      if (!centeredRef.current) {
        centeredRef.current = true;
        setPosition({ x: size.width / 2, y: size.height / 2 });
      }
    }
  }, [size.width, size.height]);

  const {
    isPanning,
    isPanningRef,
    handlePanMouseDown,
    handleDragMove,
    handleDragEnd,
  } = useCanvasPanning(stageRef, setPosition);

  const { handleWheel } = useCanvasZoom(stageRef);

  const {
    drawingPoints,
    mousePos,
    updateDrawingMousePosition,
    clearDrawingMousePosition,
    handleStageClick,
    handlePolygonClose,
    cancelDrawing,
  } = useCanvasDrawing({ activeTool, stageRef, clearSelection, addObject });

  const {
    isMidpointDragging,
    handleMidpointMouseDown,
    handleMidpointDragMouseMove,
    handleMidpointDragEnd,
  } = useCanvasMidpointDrag({ stageRef, insertVertex, moveVertexAt, finalizeVertexMoveAt, selectVertex });

  const { handleVertexDragMove, handleVertexDragEnd } = useCanvasVertexDrag(moveVertexAt, finalizeVertexMoveAt);

  useCanvasAutosave();

  const { handleKeyDown } = useCanvasKeyboard({
    activeTool,
    drawingPointsCount: drawingPoints.length,
    selectedObject: selectedStoreObject,
    selectedVertexRefs,
    setActiveTool,
    clearSelection,
    selectVertex,
    deleteObject,
    deleteVertex,
    deleteVertices,
    cancelDrawing,
  });

  // Keep canvas focusable for keyboard events
  useEffect(() => {
    containerRef.current?.focus();
  }, [activeTool, containerRef]);

  // Compose mouse move: drawing preview + midpoint drag
  const handleMouseMove = useCallback(
    () => {
      updateDrawingMousePosition();
      handleMidpointDragMouseMove();
    },
    [updateDrawingMousePosition, handleMidpointDragMouseMove],
  );

  // Compose mouse up: midpoint drag
  const handleMouseUp = useCallback(
    () => {
      handleMidpointDragEnd();
    },
    [handleMidpointDragEnd],
  );

  // Compose mouse leave: drawing preview + midpoint drag
  const handleMouseLeave = useCallback(() => {
    clearDrawingMousePosition();
    handleMidpointDragEnd();
  }, [clearDrawingMousePosition, handleMidpointDragEnd]);

  const selectedObject =
    activeTool === "select" && selectedStoreObject &&
      !(movingObject !== null && sameObject(movingObject, selectedStoreObject))
      ? selectedStoreObject
      : null;

  const selectedObjectForHandles =
    selectedObject;

  const selectedObjectVertices = useMemo(() => {
    if (!selectedObjectForHandles) return [];
    const live = objects.find((o) => o.id === selectedObjectForHandles.id);
    return live?.vertices ?? [];
  }, [selectedObjectForHandles, objects]);

  const isDrawing = activeTool === "addMowingArea" || activeTool === "addNoGoArea";

  const handleDeleteObject = useCallback(
    (obj: Area) => {
      deleteObject(obj);
      if (selectedStoreObject?.id === obj.id) clearSelection();
    },
    [deleteObject, selectedStoreObject?.id, clearSelection],
  );

  const handleObjectDragStart = useCallback(
    (obj: Area) => {
      if (obj.id !== selectedStoreObject?.id) {
        clearSelection();
        selectObject(obj);
      } else {
        selectVertex(null);
      }
      setMovingObject(obj);
    },
    [selectedStoreObject?.id, clearSelection, selectObject, selectVertex],
  );

  const handleObjectDragEnd = useCallback(
    (obj: Area, dx: number, dy: number) => {
      moveObject(obj, dx, dy);
      setMovingObject(null);
    },
    [moveObject],
  );

  const handleVertexClick = useCallback(
    (ref: VertexRef, ctrl: boolean) => toggleVertexSelection(ref, ctrl),
    [toggleVertexSelection],
  );

  const handleVertexDragStart = useCallback(
    (ref: VertexRef) => {
      const targetObject = objects.find((obj) => obj.id === ref.objectId);
      clearSelection();
      if (targetObject) selectObject(targetObject);
      selectVertex(ref);
      setDraggingVertexRef(ref);
      beginBatch();
    },
    [objects, clearSelection, selectObject, selectVertex],
  );

  const handleVertexDragEndCb = useCallback(
    (ref: VertexRef, pos: Point) => {
      setDraggingVertexRef(null);
      handleVertexDragEnd(ref, pos);

      const latestObject = useCanvasObjectStore
        .getState()
        .objects.find((obj) => obj.id === ref.objectId);

      if (latestObject && latestObject.vertices.length > 0) {
        const nearestIndex = latestObject.vertices.reduce((bestIndex, vertex, index) => {
          const best = latestObject.vertices[bestIndex]!;
          const bestDistSq = (best.x - pos.x) * (best.x - pos.x) + (best.y - pos.y) * (best.y - pos.y);
          const currentDistSq = (vertex.x - pos.x) * (vertex.x - pos.x) + (vertex.y - pos.y) * (vertex.y - pos.y);
          return currentDistSq < bestDistSq ? index : bestIndex;
        }, 0);

        selectVertex({ objectId: ref.objectId, index: nearestIndex });
      } else {
        selectVertex(ref);
      }

      endBatch();
    },
    [handleVertexDragEnd, selectVertex],
  );

  function resolveCursor() {
    if (isPanning) return "grabbing";
    if (movingObject !== null) return "grabbing";
    if (isMidpointDragging || isHoveringHandle  || draggingVertexRef !== null || isDrawing) return "crosshair";
    if (isHoveringObject !== null && activeTool === "select") return "move";
    if (isHoveringObject && activeTool === "delete") return "crosshair";
    return "default";
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-page overflow-hidden outline-none relative"
      style={{ cursor: resolveCursor() }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Satellite map tiles — CSS div behind the transparent Konva Stage */}
      <CanvasMapTileLayer />
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={position.x}
        y={position.y}
        scaleX={scale}
        scaleY={scale}
        draggable={false}
        onMouseDown={handlePanMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleStageClick}
        onContextMenu={handlePolygonClose}
        onWheel={handleWheel}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <CanvasGridLayer width={size.width} height={size.height} />
        {areasVisible && [AREA_CATEGORY.MOWING, AREA_CATEGORY.NO_GO].map((category) => (
          <CanvasPolygonObjectsLayer
            key={category}
            category={category}
            objects={objects}
            selectedObject={selectedStoreObject}
            movingObject={movingObject}
            activeTool={activeTool}
            scale={scale}
            isPanningRef={isPanningRef}
            onSelectObject={selectObject}
            onDeleteObject={handleDeleteObject}
            onObjectHoverChange={setIsHoveringObject}
            onObjectDragStart={handleObjectDragStart}
            onObjectDragEnd={handleObjectDragEnd}
          />
        ))}

        <CanvasVertexHandlesLayer
          selectedObject={selectedObjectForHandles}
          selectedObjectVertices={selectedObjectVertices}
          activeTool={activeTool}
          scale={scale}
          selectedVertexRefs={selectedVertexRefs}
          draggingVertexRef={draggingVertexRef}
          onVertexClick={handleVertexClick}
          onVertexDragStart={handleVertexDragStart}
          onVertexDragMove={handleVertexDragMove}
          onVertexDragEnd={handleVertexDragEndCb}
          onEdgeMidpointMouseDown={handleMidpointMouseDown}
          onHandleHoverChange={setIsHoveringHandle}
        />

        <CanvasDrawingPreviewLayer
          activeTool={activeTool}
          drawingPoints={drawingPoints}
          mousePos={mousePos}
          scale={scale}
        />
      </Stage>
    </div>
  );
}