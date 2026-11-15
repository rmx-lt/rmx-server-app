import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import type { ControlsPanelSectionSelectProps } from "@/components/controls-panel/controlsPanelTypes";

export default function ControlsPanelSectionSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: ControlsPanelSectionSelectProps) {
  const selectedOption = options.find((o) => o.value === value);
  const hasValue = !!value;

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      {({ open }) => {
        const isFloated = hasValue || open;
        return (
          <div className="relative mx-3 my-1">
            <ListboxButton
              className={`relative w-full border border-line-strong rounded bg-surface text-left select-none focus:outline-none transition-colors cursor-pointer data-open:border-accent-hover data-disabled:cursor-not-allowed`}
            >
              {/* Floating label */}
              <span
                className={`absolute pointer-events-none select-none transition-all duration-150 leading-none ${isFloated
                  ? `top-1 bottom-1 left-3 text-xs ${open ? "text-accent" : "text-muted"}`
                  : "top-1/2 -translate-y-1/2 left-3 text-sm text-faint"
                  }`}
              >
                {label}
              </span>

              {/* Value + chevron */}
              <div className={`flex items-center px-3 gap-1 ${isFloated ? "pt-5 pb-1" : "py-1.5"}`}>
                <span
                  className={`text-sm flex-1 truncate ${!hasValue ? "invisible" : disabled ? "text-faint" : "text-fg"
                    }`}
                >
                  {selectedOption?.label ?? "\u00A0"}
                </span>
                <span
                  className={`material-symbols-outlined shrink-0 transition-transform duration-150 ${disabled ? "text-faint" : open ? "rotate-180 text-accent" : "text-faint"
                    }`}
                  style={{ fontSize: 16 }}
                >
                  expand_more
                </span>
              </div>
            </ListboxButton>

            <ListboxOptions className="absolute left-0 right-0 top-full mt-0.5 border border-line-strong rounded shadow-md bg-surface max-h-40 overflow-y-auto outline-none z-50">
              {options.map((option) => (
                <ListboxOption
                  key={option.value}
                  value={option.value}
                  className="px-3 py-1.5 text-sm cursor-pointer transition-colors border-b-2 border-surface last:border-b-0 text-fg data-focus:bg-accent data-focus:text-on-accent data-selected:bg-accent data-selected:text-on-accent data-selected:font-medium"
                >
                  {option.label || "\u00A0"}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        );
      }}
    </Listbox>
  );
}
