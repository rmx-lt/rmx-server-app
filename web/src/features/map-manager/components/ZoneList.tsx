import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Ellipsis, Pencil } from "lucide-react";
import { useState } from "react";
import RenameInput, { menuItem } from "@/components/ui/RenameInput";
import Tooltip from "@/components/tooltip/Tooltip";
import { ZONE_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { useMapStore } from "@/model/mapStore";

function ZoneRow({ id, name, isActive }: { id: number; name: string; isActive: boolean }) {
    const renameZone = useMapStore((s) => s.renameZone);
    const [renaming, setRenaming] = useState(false);

    function finishRename(next?: string) {
        setRenaming(false);
        if (next !== undefined) renameZone(id, next);
    }

    return (
        <li className={`flex items-center rounded-xl ${isActive ? "bg-hover" : "hover:bg-hover"}`}>
            {renaming ? (
                <RenameInput name={name} label="Zone name" maxLength={ZONE_NAME_MAX_LENGTH} onDone={finishRename} />
            ) : (
                <Tooltip label={`${name}: double-click to rename`}>
                    <button
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onDoubleClick={() => setRenaming(true)}
                        className={`min-w-0 flex-1 cursor-pointer truncate rounded-xl px-3 py-2 text-left text-sm text-fg ${isActive ? "font-medium" : ""}`}
                    >
                        {name}
                    </button>
                </Tooltip>
            )}
            {!renaming && (
            <Menu>
                <Tooltip label="Zone menu">
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
                </MenuItems>
            </Menu>
            )}
        </li>
    );
}

/** The open map's zones, the active one marked; double-click or the menu renames (the autosave saves it). */
export default function ZoneList() {
    const zones = useMapStore((s) => s.zones);
    const activeZoneId = useMapStore((s) => s.activeZoneId);

    return (
        <section aria-labelledby="zone-list-heading" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            <h2 id="zone-list-heading" className="px-3 text-xs font-medium text-faint">
                Zones
            </h2>
            <ul aria-label="Zones" className="flex flex-col gap-0.5">
                {zones.map((z) => (
                    <ZoneRow key={z.id} id={z.id} name={z.name} isActive={z.id === activeZoneId} />
                ))}
            </ul>
        </section>
    );
}
