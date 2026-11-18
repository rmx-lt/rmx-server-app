import { useState } from "react";
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

/** Why the browser could not read the position, from the error code. */
function locationError(e: GeolocationPositionError): string {
    if (e.code === e.PERMISSION_DENIED) return "Location access is blocked for this site; allow it in the browser's site settings, or type the coordinates.";
    if (e.code === e.POSITION_UNAVAILABLE) return "The device could not work out its position (no GPS or network location); type the coordinates instead.";
    if (e.code === e.TIMEOUT) return "Reading the location took too long; try again or type the coordinates.";
    return `The location could not be read (${e.message || "unknown error"}); type the coordinates instead.`;
}

/** The default geo anchor for new maps, and the open map's own anchor (set here, not from the canvas). */
export default function MapDefaultsPage() {
    const mapId = useMapStore((s) => s.map.id);
    const mapName = useMapStore((s) => s.map.name);
    const systemDraft = useGeoAnchorStore((s) => s.systemDraft);
    const mapDraft = useGeoAnchorStore((s) => s.mapDraft);
    const systemGeoAnchor = useGeoAnchorStore((s) => s.systemGeoAnchor);
    const { setSystemGeoAnchorDraft, setSystemGeoAnchor, setMapGeoAnchorDraft, setMapGeoAnchor } = useGeoAnchorStore.getState();
    const [error, setError] = useState<string | null>(null);

    const locate = () => {
        setError(null);
        // Browsers only offer the position on https (or localhost).
        if (!window.isSecureContext) return setError("The browser only shares its location on a secure (https) page; type the coordinates instead.");
        if (!navigator.geolocation) return setError("This browser cannot tell where you are.");
        navigator.geolocation.getCurrentPosition(
            (p) => void setMapGeoAnchor(mapId, { lat: p.coords.latitude, lon: p.coords.longitude }),
            (e) => setError(locationError(e)),
            { timeout: 15000 },
        );
    };

    return (
        <>
            <SettingsPanelSeparator label="Default geo anchor for new maps" />
            <AnchorFields draft={systemDraft} onChange={(d) => void setSystemGeoAnchorDraft(d)} onClear={() => void setSystemGeoAnchor(null)} />
            <SettingsPanelSeparator label={`Geo anchor of "${mapName}"`} />
            <SettingsPanelRow label="">
                <div className="flex flex-wrap gap-2">
                    <Button onClick={locate}>Use my location</Button>
                    <Button disabled={!systemGeoAnchor} onClick={() => void setMapGeoAnchor(mapId, systemGeoAnchor ?? null)}>
                        Use my default
                    </Button>
                </div>
            </SettingsPanelRow>
            {error && <p role="alert" className="px-1 text-sm text-danger">{error}</p>}
            <AnchorFields draft={mapDraft} onChange={(d) => void setMapGeoAnchorDraft(mapId, d)} onClear={() => void setMapGeoAnchor(mapId, null)} />
        </>
    );
}
