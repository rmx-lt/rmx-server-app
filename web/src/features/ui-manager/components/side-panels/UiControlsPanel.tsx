import { useRef, useEffect, useState } from "react";
import { useUiControlsPanelStore } from "@/features/ui-manager/stores/uiControlsPanelStore";
import { useUiInspectorPanelStore } from "@/features/ui-manager/stores/uiInspectorPanelStore";

interface UiControlsPanelProps {
  children: React.ReactNode;
}

const MIN_WIDTH = 150;
const MAX_WIDTH = 600;
const COLLAPSE_THRESHOLD = MIN_WIDTH / 2;
const MIN_GAP = 200;

export default function UiControlsPanel({ children }: UiControlsPanelProps) {
  const isVisible = useUiControlsPanelStore((state) => state.isVisible);
  const setVisibility = useUiControlsPanelStore((state) => state.setVisibility);
  const width = useUiControlsPanelStore((state) => state.width);
  const setWidth = useUiControlsPanelStore((state) => state.setWidth);
  const isPushCollapsed = useUiControlsPanelStore((state) => state.isDragCollapsed);
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
      const myState = useUiControlsPanelStore.getState();
      if (!myState.isVisible || myState.isDragCollapsed) return;
      const inspectorState = useUiInspectorPanelStore.getState();
      const otherWidth = (inspectorState.isVisible && !inspectorState.isDragCollapsed) ? inspectorState.width : 0;
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
    const myWidth = useUiControlsPanelStore.getState().width;
    const inspectorState = useUiInspectorPanelStore.getState();
    if (!inspectorState.isVisible) return;
    const available = containerWidth - MIN_GAP;
    const otherFinal = Math.max(MIN_WIDTH, available - myWidth);
    const myFinal = Math.max(MIN_WIDTH, available - otherFinal);
    if (otherFinal < inspectorState.width) inspectorState.setWidth(otherFinal);
    if (myFinal < myWidth) setWidth(myFinal);
  }, [isVisible, setWidth]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.target === resizeHandleRef.current) {
        isDraggingRef.current = true;
        startXRef.current = e.clientX;
        startWidthRef.current = useUiControlsPanelStore.getState().width;
        pushedStartWidthRef.current = useUiInspectorPanelStore.getState().width;
        setResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const rawWidth = startWidthRef.current + (e.clientX - startXRef.current);

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
      const inspectorState = useUiInspectorPanelStore.getState();
      let newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rawWidth));

      if (inspectorState.isVisible) {
        const leftover = containerWidth - newWidth - MIN_GAP;

        if (leftover < COLLAPSE_THRESHOLD) {
          // Push-collapse zone: inspector collapses, dragging panel continues freely
          if (!inspectorState.isDragCollapsed) {
            inspectorState.setDragCollapsed(true);
          }
        } else {
          if (inspectorState.isDragCollapsed) {
            inspectorState.setDragCollapsed(false);
          }
          if (leftover < MIN_WIDTH) {
            // Push-stop zone: inspector is at minimum, cap the dragging panel
            newWidth = Math.max(MIN_WIDTH, containerWidth - MIN_WIDTH - MIN_GAP);
            inspectorState.setWidth(MIN_WIDTH);
          } else {
            // Spring zone: inspector recovers toward its pre-drag width
            inspectorState.setWidth(Math.min(pushedStartWidthRef.current, leftover));
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
        // Commit push-collapse on inspector
        const inspectorState = useUiInspectorPanelStore.getState();
        if (inspectorState.isDragCollapsed) {
          inspectorState.setDragCollapsed(false);
          inspectorState.setVisibility(false);
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
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize select-none group"
          >
            <div
              className={`absolute right-0 top-0 bottom-0 pointer-events-none transition-[width,background-color] delay-0 select-none ${isResizing
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
