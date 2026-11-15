interface ToggleToolBarButtonProps {
  titleOff: string;
  titleOn: string;
  iconOff: string;
  iconOn: string;
  isToggled: boolean;
  onChange?: (isToggled: boolean) => void;
}

export default function ToggleToolBarButton({
  titleOff,
  titleOn,
  iconOff,
  iconOn,
  isToggled,
  onChange,
}: ToggleToolBarButtonProps) {
  return (
    <button
      type="button"
      title={isToggled ? titleOn : titleOff}
      onClick={() => onChange?.(!isToggled)}
      className="w-8 h-8 flex items-center justify-center rounded text-muted hover:text-fg active:text-fg hover:bg-hover active:bg-pressed cursor-pointer select-none"
    >
      <span className="material-symbols-outlined">
        {isToggled ? iconOn : iconOff}
      </span>
    </button>
  );
}
