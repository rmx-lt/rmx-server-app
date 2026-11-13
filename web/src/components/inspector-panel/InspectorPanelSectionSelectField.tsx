import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";

interface InspectorPanelSectionSelectFieldProps {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    disabled?: boolean;
    onChange: (value: string) => void;
}

export default function InspectorPanelSectionSelectField({
    label,
    value,
    options,
    disabled,
    onChange,
}: InspectorPanelSectionSelectFieldProps) {
    const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

    return (
        <div className="flex items-center gap-2 px-5 py-1">
            <span className="w-[55%] shrink-0 truncate text-sm text-gray-800" title={label}>
                {label}
            </span>
            <Listbox value={value} onChange={onChange} disabled={disabled}>
                <div className="relative flex-1 min-w-0">
                    <ListboxButton className="group w-full flex items-center justify-between gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-sm transition-colors focus:outline-none cursor-pointer data-open:border-teal-700 data-disabled:cursor-not-allowed data-disabled:opacity-50">
                        <span className="truncate min-w-0 text-gray-900 group-data-disabled:text-gray-400">{selectedLabel}</span>
                        <span
                            className="material-symbols-outlined transition-transform duration-150 text-gray-400 group-data-open:rotate-180 group-data-open:text-teal-700"
                            style={{ fontSize: 14 }}
                        >
                            expand_more
                        </span>
                    </ListboxButton>

                    <ListboxOptions className="absolute right-0 top-full mt-0.5 min-w-full border border-gray-300 rounded shadow-md bg-white max-h-40 overflow-y-auto outline-none z-50">
                        {options.map((opt) => (
                            <ListboxOption
                                key={opt.value}
                                value={opt.value}
                                className="px-3 py-1.5 text-sm cursor-pointer transition-colors border-b-2 border-white last:border-b-0 text-gray-700 data-focus:bg-teal-600 data-focus:text-white data-selected:bg-teal-600 data-selected:text-white data-selected:font-medium"
                            >
                                {opt.label}
                            </ListboxOption>
                        ))}
                    </ListboxOptions>
                </div>
            </Listbox>
        </div>
    );
}
