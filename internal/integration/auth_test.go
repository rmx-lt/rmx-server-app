//go:build integration

// The auth domain: login, sessions, the Origin check and the user commands.

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/auth"
)

func TestLoginMeAndLogout(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)

	// The login set a cookie with all the protective attributes.
	res := app.login("Tester", password) // usernames ignore case
	eq(t, res.StatusCode, 200)
	eq(t, res.Header.Get("Cache-Control"), "no-store")
	set := res.Header.Get("Set-Cookie")
	for _, attr := range []string{"Path=/app", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=2592000"} {
		if !strings.Contains(set, attr) {
			t.Errorf("%s lacks %s", set, attr)
		}
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	eq(t, strings.TrimSpace(string(body)), `{"username":"tester"}`)

	// The database has only the SHA-256 of the token, never the token.
	token := strings.SplitN(app.cookie, "=", 2)[1]
	var stored int
	err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM sessions WHERE id_hash = sha256(convert_to($1, 'UTF8'))`, token).Scan(&stored)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, stored, 1)

	status, hdr, _ := app.req(app.http, "GET", "/api/auth/me", nil)
	eq(t, status, 200)
	eq(t, hdr.Get("Cache-Control"), "no-store")

	// Logout deletes the session; the same cookie is worthless afterwards.
	status, hdr, _ = app.req(app.http, "POST", "/api/auth/logout", nil)
	eq(t, status, 204)
	if !strings.Contains(hdr.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatal(hdr)
	}
	status, hdr, _ = app.req(app.http, "GET", "/api/auth/me", nil)
	eq(t, status, 401)
	// ...and the browser is told to drop it.
	if !strings.Contains(hdr.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatal(hdr)
	}
	_, wsStatus := app.wsWith(app.cookie, origin)
	eq(t, wsStatus, 401)

	// Logging out again is harmless.
	eq(t, app.status(app.http, "POST", "/api/auth/logout", nil), 204)
}

func TestWrongPasswordAndUnknownUser(t *testing.T) {
	app := startApp(t, newDatabase(t))
	for _, c := range [][2]string{{user, "wrong password!"}, {"nobody", password}, {"not a valid name", password}, {user, ""}} {
		res := app.login(c[0], c[1])
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		eq(t, res.StatusCode, 401)
		eq(t, res.Header.Get("Set-Cookie"), "")
		// The same answer whether the user exists or not.
		eq(t, strings.TrimSpace(string(body)), `{"code":"unauthorized","message":"wrong username or password"}`)
	}
}

func TestProtectedRoutesNeedASession(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)
	forged := cookie + "=" + strings.Repeat("ab", 32)
	malformed := cookie + "=nope"
	twice := app.cookie + "; " + app.cookie

	for _, c := range []string{"", forged, malformed, twice} {
		cl := client(c, origin)
		status, _, body := app.req(cl, "GET", "/api/auth/me", nil)
		eq(t, status, 401)
		eq(t, decode[map[string]string](t, body)["code"], "unauthorized")
		eq(t, app.status(cl, "POST", "/api/auth/logout-all", nil), 401)
		_, wsStatus := app.wsWith(c, origin)
		eq(t, wsStatus, 401)
	}
	// The refused requests ended no session.
	eq(t, app.status(app.http, "GET", "/api/auth/me", nil), 200)

	// Health is public.
	eq(t, app.status(app.anon, "GET", "/health", nil), 200)
}

func TestExpiredAndIdleSessionsAreRejected(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)
	exec := func(sql string) {
		t.Helper()
		if _, err := pool.Exec(context.Background(), sql); err != nil {
			t.Fatal(err)
		}
	}
	me := func(cookieHeader string) int {
		return app.status(client(cookieHeader, ""), "GET", "/api/auth/me", nil)
	}
	login := func() string { return sessionCookie(t, app.login(user, password)) }

	// Absolute timeout.
	a := login()
	eq(t, me(a), 200)
	exec(`UPDATE sessions SET expires_at = now() - interval '1 second'`)
	eq(t, me(a), 401)
	eq(t, me(app.cookie), 401)

	// Idle timeout (7 days without a request), though not expired yet.
	b := login()
	exec(`UPDATE sessions SET last_seen_at = now() - interval '7 days 1 minute' WHERE expires_at > now()`)
	eq(t, me(b), 401)

	// Sliding: a request moves last_seen_at forward (at most once a minute).
	c := login()
	exec(`UPDATE sessions SET last_seen_at = now() - interval '6 days'
	      WHERE expires_at > now() AND last_seen_at > now() - interval '1 hour'`)
	eq(t, me(c), 200)
	var touched bool
	err := pool.QueryRow(context.Background(),
		`SELECT last_seen_at > now() - interval '1 minute' FROM sessions WHERE id_hash = sha256(convert_to($1, 'UTF8'))`,
		strings.SplitN(c, "=", 2)[1]).Scan(&touched)
	if err != nil || !touched {
		t.Fatal("last_seen_at was not moved", err)
	}
}

func TestForeignOriginsAreRejected(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)

	for _, o := range []string{"https://evil.example", "http://app.test.evil.example", "null", ""} {
		// Logged in, but the request comes from another site's page (CSRF).
		c := client(app.cookie, o)
		status, _, body := app.req(c, "POST", "/api/auth/logout-all", nil)
		eq(t, status, 403)
		eq(t, decode[map[string]string](t, body)["code"], "forbidden")
		eq(t, app.status(c, "POST", "/api/auth/logout", nil), 403)
		// Login CSRF (logging the victim into the attacker's account) too.
		body2, _ := json.Marshal(map[string]string{"username": user, "password": password})
		req, _ := http.NewRequest("POST", app.url("/api/auth/login"), bytes.NewReader(body2))
		if o != "" {
			req.Header.Set("Origin", o)
		}
		res, err := app.anon.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		eq(t, res.StatusCode, 403)
		// Cross-site WebSocket hijacking.
		_, wsStatus := app.wsWith(app.cookie, o)
		eq(t, wsStatus, 403)
	}
	// The refused requests logged nobody out.
	eq(t, app.status(app.http, "GET", "/api/auth/me", nil), 200)

	// Reading needs no Origin (browsers don't always send it on GET), and
	// every origin in ALLOWED_ORIGINS works.
	eq(t, app.status(client(app.cookie, ""), "GET", "/api/auth/me", nil), 200)
	other := app.loginAs(client("", "http://other.allowed.test"), user, password)
	other.Body.Close()
	eq(t, other.StatusCode, 200)
	sock := app.ws()
	sock.send("p1", api.RequestPing{})
	if isError(sock.response("p1")) {
		t.Fatal("ping failed")
	}
}

func TestFailedLoginsAreRateLimited(t *testing.T) {
	app := startApp(t, newDatabase(t))
	// Five free failures, then the sixth makes the username wait 1 s.
	for range 6 {
		res := app.login(user, "wrong password!")
		res.Body.Close()
		eq(t, res.StatusCode, 401)
	}
	// While waiting, even the right password gets 429 (it isn't checked).
	res := app.login(user, password)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	eq(t, res.StatusCode, 429)
	eq(t, res.Header.Get("Retry-After"), "1")
	eq(t, decode[map[string]string](t, body)["code"], "too_many_requests")
	// Upper case doesn't get around it.
	res = app.login("TESTER", password)
	res.Body.Close()
	eq(t, res.StatusCode, 429)

	time.Sleep(1100 * time.Millisecond)
	res = app.login(user, password)
	res.Body.Close()
	eq(t, res.StatusCode, 200)
	// A success resets the count: five free failures again.
	for range 5 {
		res := app.login(user, "wrong password!")
		res.Body.Close()
		eq(t, res.StatusCode, 401)
	}
	res = app.login(user, password)
	res.Body.Close()
	eq(t, res.StatusCode, 200)
}

func TestLogoutEverywhereAndPasswordChange(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)
	login := func(pw string) string { return sessionCookie(t, app.login(user, pw)) }
	me := func(cookieHeader string) int {
		return app.status(client(cookieHeader, origin), "GET", "/api/auth/me", nil)
	}
	phone := login(password)
	eq(t, me(phone), 200)

	// "Log out everywhere" from the PC ends the phone's session too.
	eq(t, app.status(app.http, "POST", "/api/auth/logout-all", nil), 204)
	eq(t, me(app.cookie), 401)
	eq(t, me(phone), 401)

	// A new password (the set-password command) ends all sessions as well,
	// and only the new password works afterwards.
	pc := login(password)
	if err := auth.SetPassword(context.Background(), pool, user, "a brand new password"); err != nil {
		t.Fatal(err)
	}
	eq(t, me(pc), 401)
	res := app.login(user, password)
	res.Body.Close()
	eq(t, res.StatusCode, 401)
	eq(t, me(login("a brand new password")), 200)

	// A login replaces the session sent along with it (no session fixation).
	first := login("a brand new password")
	res = app.loginAs(client(first, ""), user, "a brand new password")
	res.Body.Close()
	second := sessionCookie(t, res)
	if first == second {
		t.Fatal("the session id was reused")
	}
	eq(t, me(first), 401)
	eq(t, me(second), 200)
}

func TestUserCommands(t *testing.T) {
	pool := newDatabase(t)
	ctx := context.Background()
	if err := auth.CreateUser(ctx, pool, "Alice", "twelve chars"); err != nil {
		t.Fatal(err)
	}
	var name, hash string
	if err := pool.QueryRow(ctx, `SELECT username, password_hash FROM users`).Scan(&name, &hash); err != nil {
		t.Fatal(err)
	}
	eq(t, name, "alice")
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatal(hash)
	}

	err := auth.CreateUser(ctx, pool, "alice", "twelve chars")
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("%v", err)
	}
	if auth.CreateUser(ctx, pool, "bob", "short") == nil {
		t.Error("a short password was accepted")
	}
	if auth.CreateUser(ctx, pool, "bad name", "twelve chars") == nil {
		t.Error("a bad username was accepted")
	}
	if auth.SetPassword(ctx, pool, "nobody", "twelve chars") == nil {
		t.Error("set-password for a missing user worked")
	}
	if err := auth.DeleteUser(ctx, pool, "ALICE"); err != nil {
		t.Fatal(err)
	}
	if auth.DeleteUser(ctx, pool, "alice") == nil {
		t.Error("deleting a missing user worked")
	}
}

// ---- Migrations ---------------------------------------------------------------------------

// A database the earlier Rust version of this server migrated (recorded in _sqlx_migrations)

// is adopted without running the migrations again.
