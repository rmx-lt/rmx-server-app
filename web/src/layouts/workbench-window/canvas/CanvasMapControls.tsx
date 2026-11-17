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

const PICTURE = "relative flex shrink-0 overflow-hidden rounded-xl border-2 shadow-lg";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A tile with the name under the picture (hover list: `small`; Map details). `selected` is only set in Map details. */
function Tile({ label, selected, small, onClick, children }: { label: string; selected?: boolean; small?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" aria-pressed={selected} onClick={onClick} className={`group flex cursor-pointer flex-col items-center gap-1 rounded-xl ${small ? "w-10" : "w-14"} ${FOCUS}`}>
            <span className={`${PICTURE} ${small ? "h-10 w-10" : "h-14 w-14"} items-center justify-center bg-surface ${selected ? "border-accent" : "border-surface group-hover:border-accent/60"}`}>{children}</span>
            <span className="text-[10px] font-medium leading-none text-fg">{label}</span>
        </button>
    );
}

function TypeTile({ type, selected, small }: { type: { id: MapLayer; name: string }; selected?: boolean; small?: boolean }) {
    return (
        <Tile label={type.name} selected={selected} small={small} onClick={() => useMapLayerStore.getState().set(type.id)}>
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
                    <div className="flex justify-around">
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
                        className={`group/layers ${PICTURE} h-[72px] w-[72px] cursor-pointer flex-col justify-end border-surface transition hover:-translate-y-0.5 hover:border-accent focus-visible:-translate-y-0.5 focus-visible:border-accent ${FOCUS}`}
                    >
                        <MapTypeThumb type={next.id} />
                        {/* "Layers" at rest; the type a click switches to while hovered or focused. */}
                        <span className="relative w-full bg-surface/85 py-0.5 text-center text-[10px] font-medium text-fg">
                            <span className="flex items-center justify-center gap-1 group-hover/layers:hidden group-focus-visible/layers:hidden">
                                <Layers size={11} aria-hidden />
                                Layers
                            </span>
                            <span className="hidden group-hover/layers:block group-focus-visible/layers:block">{next.name}</span>
                        </span>
                    </button>
                    {listOpen && (
                        // 72 px high like the button: 40 px pictures, the name and the padding.
                        <div className="flex h-[72px] items-center gap-2 rounded-2xl border border-line bg-surface px-2 shadow-lg">
                            {TYPES.map((t) => (
                                <TypeTile key={t.id} type={t} small />
                            ))}
                            <Tile
                                small
                                label="More"
                                onClick={() => {
                                    setListOpen(false);
                                    setDetailsOpen(true);
                                }}
                            >
                                <Layers size={18} className="text-fg" aria-hidden />
                            </Tile>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
