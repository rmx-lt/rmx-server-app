/**
 * Wires the WebSocket and the health check to the connection store: keeps the
 * socket open, pings the server over it, and polls health.
 *
 * MQTT is for devices (like the LTE gateway), which talk to the broker on
 * 8883; the page only shows whether the server's own broker link is up.
 */

import { wsUrl } from "@/lib/paths";
import { expectPong } from "@/lib/rpc";
import { useConnectionStore } from "@/stores/connectionStore";
import { checkSession, fetchHealth } from "@/transports/https";
import { WssConnection } from "@/transports/wss";

const HEALTH_INTERVAL_MS = 10_000;

const conn = () => useConnectionStore.getState();

const wss = new WssConnection(wsUrl(), {
  onState: (state, detail) => {
    conn().setWss(state, detail);
    if (state === "open") void ping();
    // A browser doesn't tell scripts why a handshake failed (a 401 looks like
    // any other failure), and the server closes the socket with 4001 when the
    // session ends. Either way, ask the server whether we're still logged in.
    if (state === "closed") void checkSession();
  },
});

/** Sends a ping over the WebSocket and records the round trip. */
export async function ping(): Promise<void> {
  const start = performance.now();
  try {
    expectPong(await wss.send({ op: "ping" }));
    conn().setLastPing({ ms: performance.now() - start });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    conn().setLastPing({ ms: performance.now() - start, error });
  }
}

async function checkHealth() {
  try {
    const health = await fetchHealth();
    conn().setHttps({ state: health.status === "ok" ? "ok" : "degraded", health });
  } catch (err) {
    conn().setHttps({ state: "down", detail: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Starts the WebSocket and health polling. Returns a stop function. Runs only
 * while logged in: the app unmounts on logout, which stops everything.
 */
export function startConnections(): () => void {
  wss.start();
  void checkHealth();
  const timer = setInterval(checkHealth, HEALTH_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    wss.stop();
  };
}
