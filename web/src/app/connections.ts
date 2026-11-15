/**
 * Keeps the WebSocket to rmx-server open while logged in. The server closes
 * it (4001) when the session ends, and a browser doesn't tell scripts why a
 * handshake failed (a 401 looks like any other failure), so on every close
 * the app asks the server whether it is still logged in; a 401 shows the
 * login form.
 */

import { wsUrl } from "@/data/api/paths";
import { WssConnection } from "@/data/api/wss";
import { checkSession } from "@/features/auth/data/session";
import { useConnectionStore } from "@/model/connectionStore";

const wss = new WssConnection(wsUrl(), {
  onState: (state) => {
    useConnectionStore.setState({ live: state === "open" });
    if (state === "closed") void checkSession();
  },
});

/** Opens the WebSocket. Returns a stop function. */
export function startConnections(): () => void {
  wss.start();
  return () => wss.stop();
}
