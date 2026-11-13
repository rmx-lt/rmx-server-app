import { useEffect, useRef, useState } from "react";
import { useEnvStore } from "@/model/envStore";
import { WORKSPACE_NAME_MAX_LENGTH } from "@/config/db-ops/databaseConstraintsConfig";
import { useShortcutsBlocked } from "@/hooks/shortcut-manager/useShortcutsBlocked";

export default function WorkspaceNameField() {
  const name = useEnvStore((state) => state.env.name);
  const setName = useEnvStore((state) => state.setName);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useShortcutsBlocked("workspace-name-field", isEditing);

  useEffect(() => {
    if (isEditing) {
      setDraft(name);
      // rAF ensures focus runs after all pending React re-renders (e.g. canvas
      // tool deactivation triggered by the shortcut blocker) so focus isn't stolen.
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [isEditing]);

  function startEditing() {
    setIsEditing(true);
  }

  function commit() {
    const trimmed = draft.trim() || name;
    setName(trimmed);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setIsEditing(false);
  }

  const sharedClass = "px-2 py-1 mb-1 text-xl text-gray-700 bg-gray-100 rounded min-w-0";

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        size={40}
        value={draft}
        maxLength={WORKSPACE_NAME_MAX_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className={`${sharedClass} w-full max-w-[40ch] outline-none ring-2 ring-teal-700 cursor-text`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Rename"
      className={`${sharedClass} w-auto max-w-[40ch] text-left truncate cursor-pointer select-none hover:bg-gray-200 active:bg-gray-300 transition-colors`}
    >
      {name}
    </button>
  );
}
