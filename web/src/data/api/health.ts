import type { Health } from "./generated/Health";

export type { Health };

/** GET /health (public). Resolves with the body even on 503 (degraded). */
export async function fetchHealth(): Promise<Health> {
  const res = await fetch("/health", { cache: "no-store" });
  if (res.status !== 200 && res.status !== 503) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Health;
}
