import Button from "@/components/ui/Button";
import SettingsPanelInput from "@/components/settings-panel/SettingsPanelRowInput";
import SettingsPanelRow from "@/components/settings-panel/SettingsPanelRow";
import SettingsPanelSeparator from "@/components/settings-panel/SettingsPanelSeparator";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useMapStore } from "@/model/mapStore";

function rangeError(value: string, limit: number, name: string): string | undefined {
    const n = Number.parseFloat(value);
    if (value !== "" && (Number.isNaN(n) || Math.abs(n) > limit)) return `${name}: a number from -${limit} to ${limit}`;
}

interface AnchorFieldsProps {
    draft: { lat: string; lon: string };
    onChange: (draft: { lat: string; lon: string }) => void;
    onClear: () => void;
}

export function AnchorFields({ draft, onChange, onClear }: AnchorFieldsProps) {
    return (
        <>
            <SettingsPanelInput
                label="Latitude"
                inputMode="decimal"
                value={draft.lat}
                error={rangeError(draft.lat, 90, "Latitude")}
                onChange={(lat) => onChange({ ...draft, lat })}
            />
            <SettingsPanelInput
                label="Longitude"
                inputMode="decimal"
                value={draft.lon}
                error={rangeError(draft.lon, 180, "Longitude")}
                onChange={(lon) => onChange({ ...draft, lon })}
            />
            <SettingsPanelRow label="">
                <Button disabled={draft.lat === "" && draft.lon === ""} onClick={onClear}>
                    Clear
                </Button>
            </SettingsPanelRow>
        </>
    );
}

/** The default geo anchor for new maps, and the open map's own anchor. */
export default function MapDefaultsPage() {
    const mapId = useMapStore((s) => s.map.id);
    const mapName = useMapStore((s) => s.map.name);
    const systemDraft = useGeoAnchorStore((s) => s.systemDraft);
    const mapDraft = useGeoAnchorStore((s) => s.mapDraft);
    const { setSystemGeoAnchorDraft, setSystemGeoAnchor, setMapGeoAnchorDraft, setMapGeoAnchor } = useGeoAnchorStore.getState();

    return (
        <>
            <SettingsPanelSeparator label="Default geo anchor for new maps" />
            <AnchorFields draft={systemDraft} onChange={(d) => void setSystemGeoAnchorDraft(d)} onClear={() => void setSystemGeoAnchor(null)} />
            <SettingsPanelSeparator label={`Geo anchor of "${mapName}"`} />
            <AnchorFields draft={mapDraft} onChange={(d) => void setMapGeoAnchorDraft(mapId, d)} onClear={() => void setMapGeoAnchor(mapId, null)} />
        </>
    );
}
