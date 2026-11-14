import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import { COORD_SYSTEM_OPTIONS, type CoordSystemType } from "@/config/db-ops/enums";
import { useMapStore } from "@/model/mapStore";

export default function CoordinateSystemSelect() {
    const coordSystem = useMapStore((state) => state.map.coordSystem);
    const setCoordSystem = useMapStore((state) => state.setCoordSystem);

    function handleChange(nextValue: string) {
        setCoordSystem(nextValue as CoordSystemType);
    }

    return (
        <ControlsPanelSectionSelect
            label="Coordinate System"
            value={coordSystem}
            onChange={handleChange}
            options={COORD_SYSTEM_OPTIONS}
        />
    );
}
