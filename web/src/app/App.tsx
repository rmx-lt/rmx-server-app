import { useEffect } from "react";
import ShortcutManager from "@/components/shortcut-manager/ShortcutManager";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { checkSession } from "@/features/auth/data/session";
import { useAuthStore } from "@/features/auth/stores/authStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { initializeWorkspace } from "@/features/workspace-manager/data/workspaceBridge";
import { useBeforeUnload } from "@/hooks/useBeforeUnload";
import WorkbenchWindow from "@/layouts/workbench-window/WorkbenchWindow";
import { startConnections } from "./connections";

/** Login form or the workbench, depending on whether the server knows our session. */
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

  if (state === "checking") return <p className="min-h-full bg-zinc-950 p-4 text-sm text-zinc-400">Connecting to the server…</p>;
  if (state === "logged-out") return <LoginForm />;
  return <Workbench />;
}

/** blade-terminal's workbench; mounted only while logged in. */
function Workbench() {
  useBeforeUnload();

  useEffect(() => {
    const stopConnections = startConnections();
    useUiUnitOfMeasureStore.getState().initialize().catch(console.error);
    initializeWorkspace().catch(console.error);
    return () => {
      stopConnections();
    };
  }, []);

  return (
    <>
      <ShortcutManager />
      <WorkbenchWindow />
    </>
  );
}

export default App;
