/** The WebSocket URL on the page's own origin (wss:// behind HTTPS). */
export function wsUrl(loc: Pick<Location, "protocol" | "host"> = location): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}/ws`;
}
