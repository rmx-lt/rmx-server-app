import { useEffect, useRef, useState } from "react";
import { useShortcutsBlocked } from "@/hooks/shortcut-manager/useShortcutsBlocked";

/** Classes of one item of a Headless UI menu list. */
const menuItemBase = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm";
export const menuItem = `${menuItemBase} text-fg data-focus:bg-hover`;
/** A menu item that deletes. */
export const menuItemDanger = `${menuItemBase} text-danger data-focus:bg-danger-soft`;

/**
 * A name being renamed in a list: Enter or leaving the field hands the text to
 * onDone, Escape hands nothing. Keyboard shortcuts are off while it is open.
 */
export default function RenameInput({ name, label, maxLength, onDone }: { name: string; label: string; maxLength: number; onDone: (name?: string) => void }) {
    const [draft, setDraft] = useState(name);
    const ref = useRef<HTMLInputElement>(null);
    useShortcutsBlocked("list-rename", true);
    useEffect(() => {
        // After the menu has given focus back to its button.
        const id = requestAnimationFrame(() => ref.current?.select());
        return () => cancelAnimationFrame(id);
    }, []);
    return (
        <input
            ref={ref}
            aria-label={label}
            value={draft}
            maxLength={maxLength}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onDone(draft)}
            onKeyDown={(e) => {
                if (e.key === "Enter") onDone(draft);
                if (e.key === "Escape") onDone();
            }}
            className="m-1 min-w-0 flex-1 rounded-lg bg-page px-2.5 py-1.5 text-sm text-fg outline-none ring-2 ring-accent"
        />
    );
}
