import { useState, type FormEvent } from "react";
import { useAuthStore } from "@/features/auth/stores/authStore";
import { login } from "@/features/auth/data/session";
import logo from "@/assets/rmx-logo.png";

/**
 * The page's own login. There is no sign-up: users are created on the server
 * (`rmx-server create-user`). The password goes to the server once, over
 * HTTPS; afterwards the browser holds only the session cookie.
 */
export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const notice = useAuthStore((s) => s.notice);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login({ username, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent-hover disabled:opacity-60";

  return (
    <div className="flex min-h-full items-center justify-center bg-page p-4 text-fg">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3 rounded-md border border-line p-5">
        <div>
          <img src={logo} alt="" className="mb-3 h-12 w-12 rounded-lg ring-1 ring-line" />
          <h1 className="text-lg font-semibold">RMX</h1>
          <p className="text-sm text-muted">Log in to continue</p>
        </div>
        {notice && !error && <p className="text-sm text-muted">{notice}</p>}
        <input
          className={input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          aria-label="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          disabled={busy}
        />
        <input
          className={input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          required
          disabled={busy}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !username || !password}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
