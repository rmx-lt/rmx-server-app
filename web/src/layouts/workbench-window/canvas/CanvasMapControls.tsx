import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Layers, X } from "lucide-react";
import { useMapLayerStore, type MapLayer } from "@/model/mapLayerStore";

// Thumbnails are flat colours and drawn shapes, not tiles: no request, and the control works offline.
const GRID = "repeating-linear-gradient(0deg, transparent 0 7px, #8b94a3 7px 8px), repeating-linear-gradient(90deg, transparent 0 7px, #8b94a3 7px 8px), #eef0f3";
const TYPES: { id: MapLayer; name: string; thumb: string }[] = [
    { id: "satellite", name: "Satellite", thumb: "linear-gradient(135deg, #3f5f3a 0 50%, #6d7f4f 50% 100%)" },
    { id: "street", name: "Map", thumb: "linear-gradient(135deg, #e8e4d8 0 50%, #aacbe8 50% 100%)" },
    { id: "empty", name: "Empty", thumb: GRID },
];
const byId = (id: MapLayer) => TYPES.find((t) => t.id === id)!;

/** How long the list stays open after the cursor has left the button and the list. */
const CLOSE_DELAY_MS = 2000;

const TILE = "flex h-14 w-14 cursor-pointer flex-col justify-end overflow-hidden rounded-xl border-2 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-accent";

function Tile({ thumb, label, selected, onClick, children }: { thumb?: string; label: string; selected?: boolean; onClick: () => void; children?: ReactNode }) {
    const style: CSSProperties | undefined = thumb ? { background: thumb } : undefined;
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onClick}
            className={`${TILE} ${selected ? "border-accent" : "border-surface"} ${thumb ? "" : "items-center bg-surface text-fg"}`}
            style={style}
        >
            {children}
            <span className="w-full bg-surface/85 py-0.5 text-center text-[10px] font-medium text-fg">{label}</span>
        </button>
    );
}

/** Layers (Satellite / Map / Empty), in the bottom left corner of the canvas, like the Layers control of Google Maps. */
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
    const select = (id: MapLayer) => useMapLayerStore.getState().set(id);

    return (
        <div className="pointer-events-auto absolute bottom-4 max-md:bottom-20 left-3">
            {detailsOpen && (
                <section role="dialog" aria-label="Map details" className="absolute bottom-full left-0 mb-2 w-64 rounded-2xl border border-line bg-surface p-3 shadow-lg">
                    <header className="mb-2 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-fg">Map details</h2>
                        <button type="button" aria-label="Close map details" onClick={() => setDetailsOpen(false)} className="cursor-pointer rounded-md p-1 text-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent">
                            <X size={16} aria-hidden />
                        </button>
                    </header>
                    {/* A section is a titled block; add further ones (detail layers) next to this one. */}
                    <h3 className="mb-1.5 text-xs font-medium text-muted">Map type</h3>
                    <div className="flex gap-2">
                        {TYPES.map((t) => (
                            <Tile key={t.id} thumb={t.thumb} label={t.name} selected={layer === t.id} onClick={() => select(t.id)} />
                        ))}
                    </div>
                </section>
            )}
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
                    className={`${TILE} border-surface`}
                    style={{ background: next.thumb }}
                >
                    <span className="w-full bg-surface/85 py-0.5 text-center text-[10px] font-medium text-fg">{next.name}</span>
                </button>
                {listOpen && (
                    <div className="flex items-end gap-2">
                        {TYPES.map((t) => (
                            <Tile key={t.id} thumb={t.thumb} label={t.name} selected={layer === t.id} onClick={() => select(t.id)} />
                        ))}
                        <Tile label="More" onClick={() => setDetailsOpen(true)}>
                            <Layers size={20} className="mb-1.5 self-center" aria-hidden />
                        </Tile>
                    </div>
                )}
            </div>
        </div>
    );
}
