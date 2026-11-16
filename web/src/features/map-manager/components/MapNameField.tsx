import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/tooltip/Tooltip";
import { useMapStore } from "@/model/mapStore";
import { MAP_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { useShortcutsBlocked } from "@/hooks/shortcut-manager/useShortcutsBlocked";

const shared = "rounded-lg px-2.5 py-1 text-sm font-medium text-fg";
// As wide as the name, between a minimum and a maximum.
const width = "max-w-[min(28rem,100%)]";

/** The open map's name at the left of the top bar; click to rename. */
export default function MapNameField() {
    const name = useMapStore((s) => s.map.name);
    const setName = useMapStore((s) => s.setName);
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const inputRef = useRef<HTMLInputElement>(null);

    useShortcutsBlocked("map-name-field", isEditing);

    useEffect(() => {
        if (!isEditing) return;
        // After pending renders (the shortcut block puts the canvas tool away), so focus isn't stolen.
        const id = requestAnimationFrame(() => inputRef.current?.select());
        return () => cancelAnimationFrame(id);
    }, [isEditing]);

    function commit() {
        setName(draft.trim() || name);
        setIsEditing(false);
    }

    if (isEditing) {
        // A hidden copy of the text sets the width (CSS field-sizing is missing in Firefox); the input fills it.
        return (
            <span className={`relative inline-grid min-w-0 ${width}`}>
                <span aria-hidden className={`${shared} invisible col-start-1 row-start-1 overflow-hidden whitespace-pre`}>
                    {draft || " "}
                </span>
                <input
                    ref={inputRef}
                    type="text"
                    aria-label="Map name"
                    value={draft}
                    maxLength={MAP_NAME_MAX_LENGTH}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commit();
                        if (e.key === "Escape") setIsEditing(false);
                    }}
                    className={`${shared} col-start-1 row-start-1 w-full min-w-0 bg-surface outline-none ring-2 ring-accent`}
                />
            </span>
        );
    }

    return (
        <Tooltip label="Rename map">
            <button
                type="button"
                onClick={() => {
                    setDraft(name);
                    setIsEditing(true);
                }}
                className={`${shared} ${width} min-w-6 cursor-pointer truncate text-left hover:bg-hover`}
            >
                {name}
            </button>
        </Tooltip>
    );
}
