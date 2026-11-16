import { useEffect } from "react";
import ShortcutManager from "@/components/shortcut-manager/ShortcutManager";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { checkSession } from "@/features/auth/data/session";
import { useAuthStore } from "@/features/auth/stores/authStore";
import { useGeoAnchorStore } from "@/model/geoAnchorStore";
import { useUiUnitOfMeasureStore } from "@/features/ui-manager/stores/uiUnitOfMeasureStore";
import { openStartMap } from "@/features/map-manager/data/mapBridge";
import HomeWindow from "@/layouts/home-window/HomeWindow";
import WorkbenchWindow from "@/layouts/workbench-window/WorkbenchWindow";
import { usePageStore } from "@/model/pageStore";
import { startConnections } from "./connections";
import { resetSettings } from "@/data/planning/settings";

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

  if (state === "checking") return <p className="min-h-full bg-page p-4 text-sm text-muted">Connecting to the server…</p>;
  if (state === "logged-out") return <LoginForm />;
  return <Workbench />;
}

/** Home or the workbench; mounted only while logged in. */
function Workbench() {
  const page = usePageStore((s) => s.page);
  useEffect(() => {
    const stopConnections = startConnections();
    // A new login: read this user's settings.
    resetSettings();
    useUiUnitOfMeasureStore.getState().initialize().catch(console.error);
    useGeoAnchorStore.getState().loadSystemGeoAnchor().catch(console.error);
    openStartMap().catch(console.error);
    return () => {
      stopConnections();
    };
  }, []);

  return (
    <>
      <ShortcutManager />
      {page === "home" ? <HomeWindow /> : <WorkbenchWindow />}
    </>
  );
}

export default App;
