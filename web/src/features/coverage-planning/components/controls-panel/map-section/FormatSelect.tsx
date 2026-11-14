import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import { MAP_FORMAT_OPTIONS, type MapFormat } from "@/config/db-ops/enums";
import { useMapStore } from "@/model/mapStore";

export default function FormatSelection() {
    const format = useMapStore((state) => state.map.format);
    const setFormat = useMapStore((state) => state.setFormat);

    function handleChange(nextValue: string) {
        setFormat(nextValue as MapFormat);
    }

    return (
        <ControlsPanelSectionSelect
            label="Format"
            value={format}
            onChange={handleChange}
            options={MAP_FORMAT_OPTIONS}
        />
    );
}