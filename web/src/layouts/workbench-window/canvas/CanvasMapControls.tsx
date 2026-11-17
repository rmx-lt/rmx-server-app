import { useEffect, useRef, useState, type ReactNode } from "react";
import { Layers, X } from "lucide-react";
import { useMapLayerStore, type MapLayer } from "@/model/mapLayerStore";
import MapTypeThumb from "./MapTypeThumb";

// The saved value of the setting stays "empty"; only the name the user sees is Grid.
const TYPES: { id: MapLayer; name: string }[] = [
    { id: "satellite", name: "Satellite" },
    { id: "street", name: "Map" },
    { id: "empty", name: "Grid" },
];
const byId = (id: MapLayer) => TYPES.find((t) => t.id === id)!;

/** How long the list stays open after the cursor has left the button and the list. */
const CLOSE_DELAY_MS = 2000;

const PICTURE = "relative flex h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2 shadow-lg";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A tile with the name under the picture (hover list, Map details). `selected` is only set in Map details. */
function Tile({ label, selected, onClick, children }: { label: string; selected?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" aria-pressed={selected} onClick={onClick} className={`group flex w-14 cursor-pointer flex-col items-center gap-1 rounded-xl ${FOCUS}`}>
            <span className={`${PICTURE} items-center justify-center bg-surface ${selected ? "border-accent" : "border-surface group-hover:border-accent/60"}`}>{children}</span>
            <span className="text-[10px] font-medium leading-none text-fg">{label}</span>
        </button>
    );
}

function TypeTile({ type, selected }: { type: { id: MapLayer; name: string }; selected?: boolean }) {
    return (
        <Tile label={type.name} selected={selected} onClick={() => useMapLayerStore.getState().set(type.id)}>
            <MapTypeThumb type={type.id} />
        </Tile>
    );
}

/** Layers (Satellite / Map / Grid), in the bottom left corner of the canvas, like the Layers control of Google Maps. */
export default function CanvasMapControls() {
    const layer = useMapLayerStore((s) => s.layer);
    const [listOpen, setListOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const timer = useRef<number | undefined>(undefined);
    const next = byId(layer === "satellite" ? "empty" : "satellite");

    useEffect(() => {
        useMapLayerStore.getState().load().catch(console.error);
        return () => window.clearTimeout(timer.current);
    }, []);

    useEffect(() => {
        if (!listOpen && !detailsOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            setListOpen(false);
            setDetailsOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [listOpen, detailsOpen]);

    const open = () => {
        window.clearTimeout(timer.current);
        setListOpen(true);
    };
    const closeLater = () => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setListOpen(false), CLOSE_DELAY_MS);
    };

    return (
        <div className="pointer-events-auto absolute bottom-4 max-md:bottom-20 left-3">
            {detailsOpen ? (
                // The panel takes the place of the button and the list.
                <section role="dialog" aria-label="Map details" className="w-64 rounded-2xl border border-line bg-surface p-3 shadow-lg">
                    <header className="mb-2 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-fg">Map details</h2>
                        <button type="button" aria-label="Close map details" onClick={() => setDetailsOpen(false)} className={`cursor-pointer rounded-md p-1 text-muted hover:text-fg ${FOCUS}`}>
                            <X size={16} aria-hidden />
                        </button>
                    </header>
                    {/* A section is a titled block; add further ones (detail layers) next to this one. */}
                    <h3 className="mb-1.5 text-xs font-medium text-muted">Map type</h3>
                    <div className="flex gap-2">
                        {TYPES.map((t) => (
                            <TypeTile key={t.id} type={t} selected={layer === t.id} />
                        ))}
                    </div>
                </section>
            ) : (
                <div
                    className="flex items-end gap-2"
                    onMouseEnter={open}
                    onMouseLeave={closeLater}
                    onFocus={open}
                    onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) setListOpen(false);
                    }}
                >
                    <button
                        type="button"
                        aria-label={`Layers: switch to ${next.name}`}
                        onClick={() => useMapLayerStore.getState().toggle()}
                        className={`${PICTURE} cursor-pointer flex-col justify-end border-surface transition hover:-translate-y-0.5 hover:border-accent focus-visible:-translate-y-0.5 focus-visible:border-accent ${FOCUS}`}
                    >
                        <MapTypeThumb type={next.id} />
                        <span className="relative w-full bg-surface/85 py-0.5 text-center text-[10px] font-medium text-fg">{next.name}</span>
                    </button>
                    {listOpen && (
                        <div className="flex items-start gap-2 rounded-2xl border border-line bg-surface p-2 shadow-lg">
                            {TYPES.map((t) => (
                                <TypeTile key={t.id} type={t} />
                            ))}
                            <Tile
                                label="More"
                                onClick={() => {
                                    setListOpen(false);
                                    setDetailsOpen(true);
                                }}
                            >
                                <Layers size={20} className="text-fg" aria-hidden />
                            </Tile>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
