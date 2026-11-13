import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import type { UnitOfMeasure } from "@/utils/unitOfMeasure";

const OPTIONS: Array<{ value: UnitOfMeasure; label: string }> = [
    { value: "none", label: "none" },
    { value: "cm", label: "cm" },
    { value: "m", label: "m" },
    { value: "km", label: "km" },
];

export default function UnitOfMeasureSelect() {
    const unitOfMeasure = useUiUnitOfMeasureStore((s) => s.unitOfMeasure);
    const setUnitOfMeasure = useUiUnitOfMeasureStore((s) => s.setUnitOfMeasure);

    const selectedLabel = OPTIONS.find((option) => option.value === unitOfMeasure)?.label ?? "UoM: none";

    return (
        <Listbox value={unitOfMeasure} onChange={(next) => { setUnitOfMeasure(next).catch(console.error); }}>
            <div className="relative">
                <ListboxButton title="Unit of measure" className="group flex items-center h-5 w-full rounded px-1.5 text-xs text-gray-500 hover:bg-gray-200 transition-colors cursor-pointer select-none">
                    <span className="flex items-center gap-0.5 justify-between">
                        <span>{selectedLabel}</span>
                    </span>
                </ListboxButton>

                <ListboxOptions className="absolute right-0 bottom-full mb-1 min-w-full border border-gray-300 rounded shadow-md bg-white outline-none z-50 overflow-hidden">
                    {OPTIONS.map((option) => (
                        <ListboxOption
                            key={option.value}
                            value={option.value}
                            className="px-3 py-1.5 text-sm cursor-pointer transition-colors border-b border-gray-100 last:border-b-0 text-gray-700 data-focus:bg-teal-600 data-focus:text-white data-selected:bg-teal-600 data-selected:text-white"
                        >
                            {option.label}
                        </ListboxOption>
                    ))}
                </ListboxOptions>
            </div>
        </Listbox>
    );
}
