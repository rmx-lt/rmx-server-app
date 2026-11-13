interface ToolBarButtonProps {
  title: string;
  icon: string;
  shortcut?: string[];
  isActive?: boolean;
  isDisabled?: boolean;
  onClick?: () => void;
}

export default function ToolBarButton({
  title,
  icon,
  shortcut,
  isActive = false,
  isDisabled = false,
  onClick,
}: ToolBarButtonProps) {
  const resolvedTitle = shortcut ? `${title} (${shortcut.join("+")})` : title;
  return (
    <button
      type="button"
      title={resolvedTitle}
      onClick={onClick}
      disabled={isDisabled}
      className={
        isActive
          ? "w-8 h-8 flex items-center justify-center rounded border-2 text-teal-700 hover:bg-gray-200 active:bg-gray-300 cursor-pointer select-none"
          : isDisabled
            ? "w-8 h-8 flex items-center justify-center rounded text-gray-400 opacity-40 cursor-not-allowed select-none"
            : "w-8 h-8 flex items-center justify-center rounded text-gray-600 hover:text-gray-900 active:text-gray-800 hover:bg-gray-200 active:bg-gray-300 cursor-pointer select-none"
      }
    >
      <span className="material-symbols-outlined">{icon}</span>
    </button>
  );
}
