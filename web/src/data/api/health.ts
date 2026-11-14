import type { Health } from "./generated/Health";
import { BASE } from "./paths";

export type { Health };

/** GET /app/health (public). Resolves with the body even on 503 (degraded). */
export async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${BASE}/health`, { cache: "no-store" });
  if (res.status !== 200 && res.status !== 503) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Health;
}
