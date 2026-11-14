import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import { COORD_SYSTEM_OPTIONS, type CoordSystemType } from "@/config/db-ops/enums";
import { useEnvStore } from "@/model/envStore";

export default function CoordinateSystemSelect() {
    const coordSystem = useEnvStore((state) => state.env.coordSystem);
    const setCoordSystem = useEnvStore((state) => state.setCoordSystem);

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
