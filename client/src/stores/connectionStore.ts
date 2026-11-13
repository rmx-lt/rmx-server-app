import { create } from "zustand";
import type { Health } from "@/generated/Health";
import type { WsState } from "@/transports/wss";

export type HttpsState = "unknown" | "ok" | "degraded" | "down";

/** The last ping over the WebSocket: its round trip, or why it failed. */
export type LastPing = {
  ms: number;
  error?: string;
};

type ConnectionState = {
  https: { state: HttpsState; health?: Health; detail?: string };
  wss: { state: WsState; detail?: string };
  lastPing?: LastPing;

  setHttps: (https: ConnectionState["https"]) => void;
  setWss: (state: WsState, detail?: string) => void;
  setLastPing: (lastPing: LastPing) => void;
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  https: { state: "unknown" },
  wss: { state: "closed" },

  setHttps: (https) => set({ https }),
  setWss: (state, detail) => set({ wss: { state, detail } }),
  setLastPing: (lastPing) => set({ lastPing }),
}));
