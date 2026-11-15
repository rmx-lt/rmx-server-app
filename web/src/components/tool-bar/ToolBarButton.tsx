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
          ? "w-8 h-8 flex items-center justify-center rounded border-2 text-accent hover:bg-hover active:bg-pressed cursor-pointer select-none"
          : isDisabled
            ? "w-8 h-8 flex items-center justify-center rounded text-faint opacity-40 cursor-not-allowed select-none"
            : "w-8 h-8 flex items-center justify-center rounded text-muted hover:text-fg active:text-fg hover:bg-hover active:bg-pressed cursor-pointer select-none"
      }
    >
      <span className="material-symbols-outlined">{icon}</span>
    </button>
  );
}
