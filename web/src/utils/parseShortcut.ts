export interface ParsedShortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

/**
 * Parses a shortcut string like "Ctrl+Alt+I" into a structured object
 * for matching against KeyboardEvent.
 */
export function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split("+").map((p) => p.trim().toLowerCase());

  return {
    ctrl: parts.includes("ctrl"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
    meta: parts.includes("meta") || parts.includes("cmd"),
    key: parts.find((p) => !["ctrl", "alt", "shift", "meta", "cmd"].includes(p)) ?? "",
  };
}

export function matchesShortcut(event: KeyboardEvent, parsed: ParsedShortcut): boolean {
  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.metaKey === parsed.meta &&
    event.key.toLowerCase() === parsed.key
  );
}
