import { useUiStatusBarStore } from "@/features/ui-manager/stores/uiStatusBarStore";

interface UiStatusBarProps {
  leftChildren?: React.ReactNode;
  rightChildren?: React.ReactNode;
}

export default function UiStatusBar({
  leftChildren,
  rightChildren,
}: UiStatusBarProps) {
  const isVisible = useUiStatusBarStore((state) => state.isVisible);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="flex items-center justify-between w-full h-6 bg-gray-100 border-t border-gray-300 px-1 select-none shrink-0">
      <div className="flex items-center gap-1">{leftChildren}</div>
      <div className="flex items-center gap-1">{rightChildren}</div>
    </div>
  );
}
