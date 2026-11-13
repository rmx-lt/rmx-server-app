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
              className={`relative w-full border border-gray-300 rounded bg-white text-left select-none focus:outline-none transition-colors cursor-pointer data-open:border-teal-700 data-disabled:cursor-not-allowed`}
            >
              {/* Floating label */}
              <span
                className={`absolute pointer-events-none select-none transition-all duration-150 leading-none ${isFloated
                  ? `top-1 bottom-1 left-3 text-xs ${open ? "text-teal-700" : "text-gray-500"}`
                  : "top-1/2 -translate-y-1/2 left-3 text-sm text-gray-400"
                  }`}
              >
                {label}
              </span>

              {/* Value + chevron */}
              <div className={`flex items-center px-3 gap-1 ${isFloated ? "pt-5 pb-1" : "py-1.5"}`}>
                <span
                  className={`text-sm flex-1 truncate ${!hasValue ? "invisible" : disabled ? "text-gray-400" : "text-gray-900"
                    }`}
                >
                  {selectedOption?.label ?? "\u00A0"}
                </span>
                <span
                  className={`material-symbols-outlined shrink-0 transition-transform duration-150 ${disabled ? "text-gray-300" : open ? "rotate-180 text-teal-700" : "text-gray-400"
                    }`}
                  style={{ fontSize: 16 }}
                >
                  expand_more
                </span>
              </div>
            </ListboxButton>

            <ListboxOptions className="absolute left-0 right-0 top-full mt-0.5 border border-gray-300 rounded shadow-md bg-white max-h-40 overflow-y-auto outline-none z-50">
              {options.map((option) => (
                <ListboxOption
                  key={option.value}
                  value={option.value}
                  className="px-3 py-1.5 text-sm cursor-pointer transition-colors border-b-2 border-white last:border-b-0 text-gray-700 data-focus:bg-teal-600 data-focus:text-white data-selected:bg-teal-600 data-selected:text-white data-selected:font-medium"
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
