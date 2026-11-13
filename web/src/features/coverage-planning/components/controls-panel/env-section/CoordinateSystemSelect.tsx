import { useEffect } from "react";
import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import { COORD_SYSTEM_OPTIONS, type CoordSystemType } from "@/config/db-ops/enums";
import { useParameterValuesStore } from "@/model/parameterValuesStore";
import { useEnvStore } from "@/model/envStore";

interface CoordinateSystemSelectProps {
    providerId?: number;
    algorithmId?: number;
    parameterId?: number;
    parameterName?: string;
    enumValues?: string[];
}

export default function CoordinateSystemSelect({
    providerId,
    algorithmId,
    parameterId,
    parameterName,
    enumValues,
}: CoordinateSystemSelectProps) {
    const envId = useEnvStore((state) => state.env.id);
    const coordSystem = useEnvStore((state) => state.env.coordSystem);
    const setCoordSystem = useEnvStore((state) => state.setCoordSystem);
    const setParameterValue = useParameterValuesStore((state) => state.setParameterValue);

    useEffect(() => {
        if (providerId === undefined || algorithmId === undefined || parameterId === undefined) return;
        setParameterValue(parameterId, algorithmId, providerId, envId, coordSystem);
    }, [algorithmId, envId, coordSystem, parameterId, providerId, setParameterValue]);

    function handleChange(nextValue: string) {
        const nextCoordSystem = nextValue as CoordSystemType;
        setCoordSystem(nextCoordSystem);

        if (providerId !== undefined && algorithmId !== undefined && parameterId !== undefined) {
            setParameterValue(parameterId, algorithmId, providerId, envId, nextCoordSystem);
        }
    }

    const options = enumValues === undefined
        ? COORD_SYSTEM_OPTIONS
        : COORD_SYSTEM_OPTIONS.filter((opt) => enumValues.includes(opt.label));

    return (
        <ControlsPanelSectionSelect
            label={parameterName ?? "Coordinate System"}
            value={coordSystem}
            onChange={handleChange}
            options={options}
        />
    );
}
