import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Copy, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAP_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { useShortcutsBlocked } from "@/hooks/shortcut-manager/useShortcutsBlocked";
import { useMapListStore } from "@/model/mapListStore";
import { useMapStore } from "@/model/mapStore";
import { duplicateMap, openMap, renameMapById, requestDeleteMap } from "@/features/map-manager/data/mapBridge";

const menuItem =
    "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg data-focus:bg-hover";

function RenameInput({ name, onDone }: { name: string; onDone: (name?: string) => void }) {
    const [draft, setDraft] = useState(name);
    const ref = useRef<HTMLInputElement>(null);
    useShortcutsBlocked("map-list-rename", true);
    useEffect(() => {
        // After the menu has given focus back to its button.
        const id = requestAnimationFrame(() => ref.current?.select());
        return () => cancelAnimationFrame(id);
    }, []);
    return (
        <input
            ref={ref}
            aria-label="Map name"
            value={draft}
            maxLength={MAP_NAME_MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onDone(draft)}
            onKeyDown={(e) => {
                if (e.key === "Enter") onDone(draft);
                if (e.key === "Escape") onDone();
            }}
            className="mx-1 min-w-0 flex-1 rounded-md bg-page px-2 py-1 text-sm text-fg outline-none ring-2 ring-accent"
        />
    );
}

function MapRow({ id, name, isOpen }: { id: number; name: string; isOpen: boolean }) {
    const [renaming, setRenaming] = useState(false);

    function finishRename(next?: string) {
        setRenaming(false);
        if (next !== undefined && next.trim() && next.trim() !== name) renameMapById(id, next).catch(console.error);
    }

    return (
        <li className={`group flex items-center rounded-lg ${isOpen ? "bg-hover" : "hover:bg-hover"}`}>
            {renaming ? (
                <RenameInput name={name} onDone={finishRename} />
            ) : (
                <button
                    type="button"
                    aria-current={isOpen ? "true" : undefined}
                    title={name}
                    onClick={() => openMap(id).catch(console.error)}
                    className={`min-w-0 flex-1 cursor-pointer truncate rounded-lg px-2.5 py-1.5 text-left text-sm ${isOpen ? "font-medium text-fg" : "text-muted group-hover:text-fg"}`}
                >
                    {name}
                </button>
            )}
            <Menu>
                <MenuButton
                    aria-label={`Menu for ${name}`}
                    title="Map menu"
                    className="mr-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted opacity-100 hover:bg-pressed hover:text-fg data-open:bg-pressed md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-open:opacity-100"
                >
                    <Ellipsis size={16} strokeWidth={1.75} />
                </MenuButton>
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

/** The user's maps, newest change first; the open one is marked. */
export default function MapList() {
    const items = useMapListStore((s) => s.items);
    const openId = useMapStore((s) => s.map.id);
    const openName = useMapStore((s) => s.map.name);

    return (
        <ul aria-label="Maps" className="flex flex-col gap-0.5">
            {items.map((m) => (
                // The open map's name is live (it may not be saved yet).
                <MapRow key={m.id} id={m.id} name={m.id === openId ? openName : m.name} isOpen={m.id === openId} />
            ))}
        </ul>
    );
}
