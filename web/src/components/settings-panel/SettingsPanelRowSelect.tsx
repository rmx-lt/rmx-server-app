import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";
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

export default function SettingsPanelSelect({ label, value, onChange, options, disabled = false }: SettingsPanelSelectProps) {
    const selectedOption = options.find((o) => o.value === value);

    return (
        <SettingsPanelRow label={label}>
            <Listbox value={value} onChange={onChange} disabled={disabled}>
                <ListboxButton
                    aria-label={label}
                    className="group flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-lg border border-line-strong bg-page px-2.5 text-left text-sm text-fg outline-none transition-colors data-focus:border-accent data-open:border-accent data-disabled:cursor-not-allowed data-disabled:opacity-50"
                >
                    <span className="flex-1 truncate">{selectedOption?.label ?? " "}</span>
                    <ChevronDown size={14} className="shrink-0 text-faint transition-transform group-data-open:rotate-180" aria-hidden />
                </ListboxButton>
                <ListboxOptions
                    anchor="bottom start"
                    className="z-70 w-(--button-width) rounded-xl border border-line bg-surface p-1 shadow-lg outline-none [--anchor-gap:4px]"
                >
                    {options.map((option) => (
                        <ListboxOption
                            key={option.value}
                            value={option.value}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg data-focus:bg-hover"
                        >
                            <span className="flex-1 truncate">{option.label}</span>
                            <Check size={14} className="invisible text-accent in-data-selected:visible" aria-hidden />
                        </ListboxOption>
                    ))}
                </ListboxOptions>
            </Listbox>
        </SettingsPanelRow>
    );
}
