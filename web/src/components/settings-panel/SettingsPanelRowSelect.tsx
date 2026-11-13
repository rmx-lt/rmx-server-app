import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import SettingsPanelRow from "./SettingsPanelRow";

export interface SettingsPanelSelectOption {
    value: string;
    label: string;
}

interface SettingsPanelSelectProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: SettingsPanelSelectOption[];
    disabled?: boolean;
}

export default function SettingsPanelSelect({
    label,
    value,
    onChange,
    options,
    disabled = false,
}: SettingsPanelSelectProps) {
    const selectedOption = options.find((o) => o.value === value);

    return (
        <SettingsPanelRow label={label}>
            <Listbox value={value} onChange={onChange} disabled={disabled}>
                <div className="relative flex-1 min-w-0">
                    <ListboxButton className="group w-full flex items-center gap-1 border border-gray-300 rounded bg-white text-left select-none focus:outline-none transition-colors px-2 h-6 cursor-pointer data-open:border-teal-700 data-disabled:cursor-not-allowed data-disabled:opacity-50">
                        <span className="text-xs flex-1 truncate text-gray-900 group-data-disabled:text-gray-400">
                            {selectedOption?.label ?? "\u00A0"}
                        </span>
                        <span
                            className="material-symbols-outlined shrink-0 transition-transform duration-150 text-gray-400 group-data-open:rotate-180 group-data-open:text-teal-700 group-data-disabled:text-gray-300"
                            style={{ fontSize: 14 }}
                        >
                            expand_more
                        </span>
                    </ListboxButton>

                    <ListboxOptions className="absolute left-0 right-0 top-full mt-0.5 border border-gray-300 rounded shadow-md bg-white max-h-40 overflow-y-auto outline-none z-50">
                        {options.map((option) => (
                            <ListboxOption
                                key={option.value}
                                value={option.value}
                                className="px-3 py-1 text-xs cursor-pointer transition-colors text-gray-700 border-b border-white last:border-b-0 data-focus:bg-teal-600 data-focus:text-white data-selected:bg-teal-600 data-selected:text-white data-selected:font-medium"
                            >
                                {option.label || "\u00A0"}
                            </ListboxOption>
                        ))}
                    </ListboxOptions>
                </div>
            </Listbox>
        </SettingsPanelRow>
    );
}
