import type { ApiError } from "./generated/ApiError";
import type { LoginRequest } from "./generated/LoginRequest";
import type { Me } from "./generated/Me";
import { BASE } from "./paths";

export type { ApiError, LoginRequest, Me };

/**
 * GET /app/api/auth/me: the logged-in user, null when nobody is (401), or
 * undefined when the server can't say (not reachable, 502 while it restarts).
 */
export async function fetchMe(): Promise<Me | null | undefined> {
  try {
    const res = await fetch(`${BASE}/api/auth/me`, { cache: "no-store" });
    if (res.ok) return (await res.json()) as Me;
    if (res.status === 401) return null;
  } catch {
    // Network error: the server can't say.
  }
  return undefined;
}

export type LoginResult =
  | { kind: "ok"; me: Me }
  | { kind: "failed"; status: number; body: ApiError | null; retryAfter: string | null }
  | { kind: "unreachable" };

/** POST /app/api/auth/login. On success the server has set the session cookie. */
export async function postLogin(credentials: LoginRequest): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
      cache: "no-store",
    });
  } catch {
    return { kind: "unreachable" };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    return { kind: "failed", status: res.status, body, retryAfter: res.headers.get("retry-after") };
  }
  return { kind: "ok", me: (await res.json()) as Me };
}

/**
 * POST /app/api/auth/logout (or logout-all). True when the server has ended
 * the session; 401 counts, since the session had already ended.
 */
export async function postLogout(everywhere: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/auth/${everywhere ? "logout-all" : "logout"}`, {
      method: "POST",
      cache: "no-store",
    });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}
