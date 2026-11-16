import { useState } from "react";
import Tooltip from "@/components/tooltip/Tooltip";
import { useAuthStore } from "@/features/auth/stores/authStore";
import { logout } from "@/features/auth/data/session";

/** Who is logged in, plus logout (this browser) and logout everywhere. */
export function UserMenu() {
  const username = useAuthStore((s) => s.username);
  const [busy, setBusy] = useState(false);

  function run(everywhere: boolean) {
    setBusy(true);
    void logout(everywhere).finally(() => setBusy(false));
  }

  const button = "rounded px-2 py-1 text-xs text-fg hover:bg-hover disabled:opacity-50";

  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="px-1 text-muted">{username}</span>
      <button type="button" className={button} disabled={busy} onClick={() => run(false)}>
        Log out
      </button>
      <Tooltip label="End every session of this user, on all devices">
        <button type="button" className={button} disabled={busy} onClick={() => run(true)}>
          Log out everywhere
        </button>
      </Tooltip>
    </div>
  );
}
