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
            <span className="w-[55%] shrink-0 truncate text-sm text-fg" title={label}>
                {label}
            </span>
            <Listbox value={value} onChange={onChange} disabled={disabled}>
                <div className="relative flex-1 min-w-0">
                    <ListboxButton className="group w-full flex items-center justify-between gap-1 rounded border border-line-strong bg-surface px-2 py-0.5 text-sm transition-colors focus:outline-none cursor-pointer data-open:border-accent-hover data-disabled:cursor-not-allowed data-disabled:opacity-50">
                        <span className="truncate min-w-0 text-fg group-data-disabled:text-faint">{selectedLabel}</span>
                        <span
                            className="material-symbols-outlined transition-transform duration-150 text-faint group-data-open:rotate-180 group-data-open:text-accent"
                            style={{ fontSize: 14 }}
                        >
                            expand_more
                        </span>
                    </ListboxButton>

                    <ListboxOptions className="absolute right-0 top-full mt-0.5 min-w-full border border-line-strong rounded shadow-md bg-surface max-h-40 overflow-y-auto outline-none z-50">
                        {options.map((opt) => (
                            <ListboxOption
                                key={opt.value}
                                value={opt.value}
                                className="px-3 py-1.5 text-sm cursor-pointer transition-colors border-b-2 border-surface last:border-b-0 text-fg data-focus:bg-accent data-focus:text-on-accent data-selected:bg-accent data-selected:text-on-accent data-selected:font-medium"
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
