import { useRef, useEffect, useState } from "react";
import { useUiInspectorPanelStore } from "@/features/ui-manager/stores/uiInspectorPanelStore";
import { useUiControlsPanelStore } from "@/features/ui-manager/stores/uiControlsPanelStore";

interface UiInspectorPanelProps {
  children: React.ReactNode;
}

const MIN_WIDTH = 150;
const MAX_WIDTH = 600;
const COLLAPSE_THRESHOLD = MIN_WIDTH / 2;
const MIN_GAP = 200;

export default function UiInspectorPanel({ children }: UiInspectorPanelProps) {
  const isVisible = useUiInspectorPanelStore((state) => state.isVisible);
  const setVisibility = useUiInspectorPanelStore((state) => state.setVisibility);
  const width = useUiInspectorPanelStore((state) => state.width);
  const setWidth = useUiInspectorPanelStore((state) => state.setWidth);
  const isPushCollapsed = useUiInspectorPanelStore((state) => state.isDragCollapsed);
  const [isResizing, setResizing] = useState(false);
  const [isSelfCollapsed, setSelfCollapsed] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const isSelfCollapsedRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const pushedStartWidthRef = useRef(0);

  // Clamp own width when the container shrinks (browser window resize)
  useEffect(() => {
    const container = panelRef.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const containerWidth = entry.contentRect.width;
      const myState = useUiInspectorPanelStore.getState();
      if (!myState.isVisible || myState.isDragCollapsed) return;
      const controlsState = useUiControlsPanelStore.getState();
      const otherWidth = (controlsState.isVisible && !controlsState.isDragCollapsed) ? controlsState.width : 0;
      const clamped = Math.max(MIN_WIDTH, Math.min(myState.width, containerWidth - MIN_GAP - otherWidth));
      if (clamped < myState.width) myState.setWidth(clamped);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Enforce gap when this panel becomes visible
  useEffect(() => {
    if (!isVisible) return;
    const containerWidth = panelRef.current?.parentElement?.clientWidth ?? Infinity;
    const myWidth = useUiInspectorPanelStore.getState().width;
    const controlsState = useUiControlsPanelStore.getState();
    if (!controlsState.isVisible) return;
    const available = containerWidth - MIN_GAP;
    const otherFinal = Math.max(MIN_WIDTH, available - myWidth);
    const myFinal = Math.max(MIN_WIDTH, available - otherFinal);
    if (otherFinal < controlsState.width) controlsState.setWidth(otherFinal);
    if (myFinal < myWidth) setWidth(myFinal);
  }, [isVisible, setWidth]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.target === resizeHandleRef.current) {
        isDraggingRef.current = true;
        startXRef.current = e.clientX;
        startWidthRef.current = useUiInspectorPanelStore.getState().width;
        pushedStartWidthRef.current = useUiControlsPanelStore.getState().width;
        setResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      // Inspector is on the right — dragging left (negative clientX diff) increases width
      const rawWidth = startWidthRef.current + (startXRef.current - e.clientX);

      if (rawWidth < COLLAPSE_THRESHOLD) {
        if (!isSelfCollapsedRef.current) {
          isSelfCollapsedRef.current = true;
          setSelfCollapsed(true);
        }
        return;
      }

      if (isSelfCollapsedRef.current) {
        isSelfCollapsedRef.current = false;
        setSelfCollapsed(false);
      }

      const containerWidth = panelRef.current?.parentElement?.clientWidth ?? Infinity;
      const controlsState = useUiControlsPanelStore.getState();
      let newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rawWidth));

      if (controlsState.isVisible) {
        const leftover = containerWidth - newWidth - MIN_GAP;

        if (leftover < COLLAPSE_THRESHOLD) {
          // Push-collapse zone: controls collapses, dragging panel continues freely
          if (!controlsState.isDragCollapsed) {
            controlsState.setDragCollapsed(true);
          }
        } else {
          if (controlsState.isDragCollapsed) {
            controlsState.setDragCollapsed(false);
          }
          if (leftover < MIN_WIDTH) {
            // Push-stop zone: controls is at minimum, cap the dragging panel
            newWidth = Math.max(MIN_WIDTH, containerWidth - MIN_WIDTH - MIN_GAP);
            controlsState.setWidth(MIN_WIDTH);
          } else {
            // Spring zone: controls recovers toward its pre-drag width
            controlsState.setWidth(Math.min(pushedStartWidthRef.current, leftover));
          }
        }
      }

      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Commit self-collapse
        if (isSelfCollapsedRef.current) {
          isSelfCollapsedRef.current = false;
          setSelfCollapsed(false);
          setVisibility(false);
        }
        // Commit push-collapse on controls
        const controlsState = useUiControlsPanelStore.getState();
        if (controlsState.isDragCollapsed) {
          controlsState.setDragCollapsed(false);
          controlsState.setVisibility(false);
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [setWidth, setVisibility]);

  const hidden = !isVisible || isSelfCollapsed || isPushCollapsed;

  return (
    <div
      ref={panelRef}
      style={{ width: hidden ? 0 : `${width}px` }}
      className="relative flex flex-col h-full shrink-0 bg-gray-100 overflow-hidden select-none pointer-events-auto"
    >
      {!hidden && (
        <>
          <div className="flex flex-col h-full overflow-auto">{children}</div>

          <div
            ref={resizeHandleRef}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize select-none group"
          >
            <div
              className={`absolute left-0 top-0 bottom-0 pointer-events-none transition-[width,background-color] delay-0 ${isResizing
                ? "w-1 bg-teal-600"
                : "w-px bg-gray-300 group-hover:w-1 group-hover:bg-teal-600 group-hover:delay-300"
                }`}
            />
          </div>
        </>
      )}
    </div>
  );
}
