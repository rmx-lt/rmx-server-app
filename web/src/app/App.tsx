import { useEffect } from "react";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { UserMenu } from "@/features/auth/components/UserMenu";
import { checkSession } from "@/features/auth/data/session";
import { useAuthStore } from "@/features/auth/stores/authStore";
import { StatusPanel } from "./components/StatusPanel";
import { startConnections } from "./connections";

/** Login form or the app, depending on whether the server knows our session. */
export function App() {
  const state = useAuthStore((s) => s.state);
  useEffect(() => {
    // Until the server answers (it may be restarting: 502 from Caddy, or not
    // started yet in development), ask again every few seconds.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const check = async () => {
      await checkSession();
      if (!stopped && useAuthStore.getState().state === "checking") timer = setTimeout(check, 3000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  if (state === "checking") return <p className="p-4 text-sm text-zinc-400">Connecting to the server…</p>;
  if (state === "logged-out") return <LoginForm />;
  return <Connected />;
}

function Connected() {
  useEffect(() => startConnections(), []);

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Blade of Grass</h1>
          <p className="text-sm text-zinc-400">Server connections (devices: MQTT)</p>
        </div>
        <UserMenu />
      </header>

      <main className="flex min-w-0 flex-col gap-4">
        <StatusPanel />
      </main>
    </div>
  );
}

export default App;
