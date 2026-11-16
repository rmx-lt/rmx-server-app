import { useEffect } from "react";
import Tooltip from "@/components/tooltip/Tooltip";
import { useMapLayerStore } from "@/model/mapLayerStore";

// Thumbnails are flat colours, not tiles: no request, and the control works offline.
const THUMB = {
    satellite: "linear-gradient(135deg, #3f5f3a 0 50%, #6d7f4f 50% 100%)",
    street: "linear-gradient(135deg, #e8e4d8 0 50%, #aacbe8 50% 100%)",
};

/** Layers (satellite / map), in the bottom left corner of the canvas. */
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
        </div>
    );
}
