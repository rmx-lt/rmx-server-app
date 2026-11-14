import CanvasEditor from "@/features/canvas-editing/components/canvas-editor/CanvasEditor";

export default function CanvasEditorLayout() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <CanvasEditor />
    </div>
  );
}
