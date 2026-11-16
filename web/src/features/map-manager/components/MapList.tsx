import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Copy, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import RenameInput, { menuItem } from "@/components/ui/RenameInput";
import Tooltip from "@/components/tooltip/Tooltip";
import { MAP_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { duplicateMap, openMap, renameMapById, requestDeleteMap } from "@/features/map-manager/data/mapBridge";
import { useMapListStore } from "@/model/mapListStore";
import { useMapStore } from "@/model/mapStore";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function MapRow({ id, name, mowing, noGo, updatedAt, isOpen }: { id: number; name: string; mowing: number; noGo: number; updatedAt: string; isOpen: boolean }) {
    const [renaming, setRenaming] = useState(false);

    function finishRename(next?: string) {
        setRenaming(false);
        if (next !== undefined && next.trim() && next.trim() !== name) renameMapById(id, next).catch(console.error);
    }

    return (
        <li className={`group flex items-center rounded-xl ${isOpen ? "bg-hover" : "hover:bg-hover"}`}>
            {renaming ? (
                <RenameInput name={name} label="Map name" maxLength={MAP_NAME_MAX_LENGTH} onDone={finishRename} />
            ) : (
                <Tooltip label={name}>
                    <button
                        type="button"
                        aria-current={isOpen ? "true" : undefined}
                        onClick={() => openMap(id).catch(console.error)}
                        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left sm:flex-row sm:items-center sm:gap-4"
                    >
                        <span className={`min-w-0 flex-1 truncate text-sm ${isOpen ? "font-medium" : ""} text-fg`}>{name}</span>
                        <span className="shrink-0 text-xs text-muted">
                            {mowing} mowing · {noGo} no-go
                        </span>
                        <span className="shrink-0 text-xs text-muted sm:w-36 sm:text-right">{when.format(new Date(updatedAt))}</span>
                    </button>
                </Tooltip>
            )}
            {isOpen && !renaming && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-on-accent">Open</span>}
            <Menu>
                <Tooltip label="Map menu">
                    <MenuButton
                        aria-label={`Menu for ${name}`}
                        className="mx-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-pressed hover:text-fg data-open:bg-pressed"
                    >
                        <Ellipsis size={16} strokeWidth={1.75} />
                    </MenuButton>
                </Tooltip>
                <MenuItems anchor="bottom end" className="z-50 w-40 rounded-xl border border-line bg-surface p-1 shadow-lg outline-none [--anchor-gap:4px]">
                    <MenuItem>
                        <button type="button" className={menuItem} onClick={() => setRenaming(true)}>
                            <Pencil size={15} strokeWidth={1.75} /> Rename
                        </button>
                    </MenuItem>
                    <MenuItem>
                        <button type="button" className={menuItem} onClick={() => duplicateMap(id).catch(console.error)}>
                            <Copy size={15} strokeWidth={1.75} /> Duplicate
                        </button>
                    </MenuItem>
                    <MenuItem>
                        <button type="button" className={`${menuItem} text-danger`} onClick={() => requestDeleteMap(id, name)}>
                            <Trash2 size={15} strokeWidth={1.75} /> Delete
                        </button>
                    </MenuItem>
                </MenuItems>
            </Menu>
        </li>
    );
}

/** The user's maps, newest change first, the open one marked; click opens, the menu renames, duplicates, deletes. */
export default function MapList() {
    const items = useMapListStore((s) => s.items);
    const refresh = useMapListStore((s) => s.refresh);
    const openId = useMapStore((s) => s.map.id);
    const openName = useMapStore((s) => s.map.name);
    const error = useMapListStore((s) => s.error);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    if (items.length === 0) return <p className="px-3 py-6 text-sm text-muted">No maps yet. Make the first one with New map.</p>;

    return (
        <>
            {error && (
                <p role="alert" className="mb-2 rounded-lg bg-hover px-3 py-2 text-sm text-danger">
                    {error}
                </p>
            )}
            <ul aria-label="Maps" className="flex flex-col gap-0.5">
            {items.map((m) => (
                // The open map's name is live (it may not be saved yet).
                <MapRow
                    key={m.id}
                    id={m.id}
                    name={m.id === openId ? openName : m.name}
                    mowing={m.mowingAreaCount}
                    noGo={m.noGoAreaCount}
                    updatedAt={m.updatedAt}
                    isOpen={m.id === openId}
                />
            ))}
            </ul>
        </>
    );
}
