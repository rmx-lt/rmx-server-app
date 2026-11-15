import { useThemeChoice } from "@/hooks/useTheme";
import { setThemeChoice, type ThemeChoice } from "@/utils/theme";

const OPTIONS: { value: ThemeChoice; icon: string; label: string }[] = [
  { value: "system", icon: "contrast", label: "Theme: follow system" },
  { value: "dark", icon: "dark_mode", label: "Theme: dark" },
  { value: "light", icon: "light_mode", label: "Theme: light" },
];

/** Temporary home of the theme choice; it moves into the settings modal (rmx-server-app#104). */
export function ThemeSwitch() {
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded border border-line-strong overflow-hidden">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={choice === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => setThemeChoice(o.value)}
          className={`flex items-center justify-center w-7 h-7 cursor-pointer transition-colors ${
            choice === o.value ? "bg-accent text-on-accent" : "text-muted hover:bg-hover"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {o.icon}
          </span>
        </button>
      ))}
    </div>
  );
}
