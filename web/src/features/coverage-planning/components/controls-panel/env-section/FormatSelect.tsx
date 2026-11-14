import ControlsPanelSectionSelect from "@/components/controls-panel/ControlsPanelSectionSelect";
import { ENV_FORMAT_OPTIONS, type EnvFormat } from "@/config/db-ops/enums";
import { useEnvStore } from "@/model/envStore";

export default function FormatSelection() {
    const format = useEnvStore((state) => state.env.format);
    const setFormat = useEnvStore((state) => state.setFormat);

    function handleChange(nextValue: string) {
        setFormat(nextValue as EnvFormat);
    }

    return (
        <ControlsPanelSectionSelect
            label="Format"
            value={format}
            onChange={handleChange}
            options={ENV_FORMAT_OPTIONS}
        />
    );
}