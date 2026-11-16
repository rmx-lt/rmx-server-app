import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Tooltip from "@/components/tooltip/Tooltip";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useMapLayerStore } from "@/model/mapLayerStore";
import { useMapStore } from "@/model/mapStore";
import { AnchorFields } from "../settings/MapDefaultsPage";

// Thumbnails are flat colours, not tiles: no request, and the control works offline.
const THUMB = {
    satellite: "linear-gradient(135deg, #3f5f3a 0 50%, #6d7f4f 50% 100%)",
    street: "linear-gradient(135deg, #e8e4d8 0 50%, #aacbe8 50% 100%)",
};

/** Layers (satellite / map) and Location, in the bottom left corner of the canvas. */
export default function CanvasMapControls() {
    const layer = useMapLayerStore((s) => s.layer);
    const next = layer === "satellite" ? "street" : "satellite";
    useEffect(() => {
        useMapLayerStore.getState().load().catch(console.error);
    }, []);
    return (
        <div className="pointer-events-auto absolute bottom-4 max-md:bottom-20 left-3 flex items-end gap-2">
            <Tooltip label={next === "street" ? "Show the street map" : "Show the satellite image"}>
                <button
                    type="button"
                    aria-label={`Layers: switch to ${next === "street" ? "map" : "satellite"}`}
                    onClick={() => useMapLayerStore.getState().toggle()}
                    className="flex h-14 w-14 cursor-pointer flex-col justify-end overflow-hidden rounded-xl border-2 border-surface shadow-lg"
                    style={{ background: THUMB[next] }}
                >
                    <span className="bg-surface/85 py-0.5 text-center text-[10px] font-medium text-fg">Layers</span>
                </button>
            </Tooltip>
            <Tooltip label="Where is this map?">
                <button
                    type="button"
                    aria-label="Set the location of the map"
                    onClick={() => useGeoAnchorStore.getState().setPromptOpen(true)}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-fg shadow-lg hover:bg-hover"
                >
                    <MapPin size={16} strokeWidth={1.75} />
                </button>
            </Tooltip>
            <MapLocationModal />
        </div>
    );
}

/** Asks where the map is: the browser's location, the default anchor or typed coordinates. Used for a new map and on demand. */
function MapLocationModal() {
    const open = useGeoAnchorStore((s) => s.promptOpen);
    const mapDraft = useGeoAnchorStore((s) => s.mapDraft);
    const systemGeoAnchor = useGeoAnchorStore((s) => s.systemGeoAnchor);
    const mapId = useMapStore((s) => s.map.id);
    const [error, setError] = useState<string | null>(null);
    const { setMapGeoAnchor, setMapGeoAnchorDraft, setPromptOpen } = useGeoAnchorStore.getState();

    const locate = () => {
        setError(null);
        if (!navigator.geolocation) return setError("This browser cannot tell where you are.");
        navigator.geolocation.getCurrentPosition(
            (p) => void setMapGeoAnchor(mapId, { lat: p.coords.latitude, lon: p.coords.longitude }),
            () => setError("Your location could not be read; type the coordinates instead."),
        );
    };

    return (
        <Modal open={open} onClose={() => setPromptOpen(false)} token="map-location">
            <div className="flex flex-col gap-3 p-5">
                <h2 className="text-lg font-medium">Where is this map?</h2>
                <p className="text-sm text-muted">The location puts the satellite image and the street map behind your zones. Leave it empty for a plain canvas.</p>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={locate}>Use my location</Button>
                    <Button disabled={!systemGeoAnchor} onClick={() => void setMapGeoAnchor(mapId, systemGeoAnchor ?? null)}>
                        Use my default
                    </Button>
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
                <AnchorFields draft={mapDraft} onChange={(d) => void setMapGeoAnchorDraft(mapId, d)} onClear={() => void setMapGeoAnchor(mapId, null)} />
                <div className="flex justify-end">
                    <Button variant="primary" onClick={() => setPromptOpen(false)}>
                        Done
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
