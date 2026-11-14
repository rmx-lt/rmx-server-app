import { fetchMe, postLogin, postLogout, type LoginRequest } from "@/data/api/auth";
import { useAuthStore } from "@/features/auth/stores/authStore";
import { loginErrorMessage } from "@/features/auth/utils/loginErrorMessage";

export const SESSION_ENDED = "Your session has ended. Please log in again.";

/** Asks the server who is logged in, and updates the auth store. */
export async function checkSession(): Promise<void> {
  const me = await fetchMe();
  if (me) useAuthStore.getState().setLoggedIn(me.username);
  else if (me === null) {
    // Logged out already: keep the notice; on first load there is none.
    const s = useAuthStore.getState();
    if (s.state !== "logged-out") s.setLoggedOut(s.state === "logged-in" ? SESSION_ENDED : undefined);
  }
  // Other errors (server down, 502 while the server is restarting): leave the state alone.
}

/** Resolves on success; rejects with a message for the login form. */
export async function login(credentials: LoginRequest): Promise<void> {
  const result = await postLogin(credentials);
  if (result.kind === "unreachable") throw new Error("The server is not reachable.");
  if (result.kind === "failed") throw new Error(loginErrorMessage(result.status, result.body, result.retryAfter));
  useAuthStore.getState().setLoggedIn(result.me.username);
}

/** Ends this session (or every session of the user). */
export async function logout(everywhere = false): Promise<void> {
  const ok = await postLogout(everywhere);
  // Stop showing data either way, but say so if the server may not know.
  useAuthStore
    .getState()
    .setLoggedOut(
      !ok
        ? "Logout didn't reach the server, so the session may still be active there. Log in and out again to be sure."
        : everywhere
          ? "Logged out on all devices."
          : "Logged out.",
    );
}
