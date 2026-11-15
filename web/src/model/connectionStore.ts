import { create } from "zustand";

/** Whether the WebSocket to the server is open (set by app/connections.ts). */
export const useConnectionStore = create<{ live: boolean }>()(() => ({ live: false }));
