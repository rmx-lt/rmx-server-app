import { useEffect, useRef, useState } from "react";
import { useMapStore } from "@/model/mapStore";
import { MAP_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { useShortcutsBlocked } from "@/hooks/shortcut-manager/useShortcutsBlocked";

/** The open map's name in the middle of the top bar; click to rename. */
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

    const shared = "min-w-0 rounded-lg px-2.5 py-1 text-center text-sm font-medium text-fg";

    if (isEditing) {
        return (
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
                className={`${shared} w-64 max-w-full bg-surface outline-none ring-2 ring-accent`}
            />
        );
    }

    return (
        <button
            type="button"
            title="Rename map"
            onClick={() => {
                setDraft(name);
                setIsEditing(true);
            }}
            className={`${shared} max-w-full cursor-pointer truncate hover:bg-hover`}
        >
            {name}
        </button>
    );
}
