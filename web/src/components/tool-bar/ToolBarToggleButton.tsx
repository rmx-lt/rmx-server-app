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
      className="w-8 h-8 flex items-center justify-center rounded text-gray-600 hover:text-gray-900 active:text-gray-800 hover:bg-gray-200 active:bg-gray-300 cursor-pointer select-none"
    >
      <span className="material-symbols-outlined">
        {isToggled ? iconOn : iconOff}
      </span>
    </button>
  );
}
