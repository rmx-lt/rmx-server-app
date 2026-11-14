//go:build integration

// What the app wires together: health, the web app's static files, the
// WebSocket, the server's MQTT status, and the migrations.

package integration

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/db"
	"github.com/rmx-lt/rmx-server-app/internal/mqtt"
)

func TestHealthAndConfig(t *testing.T) {
	app := startApp(t, newDatabase(t))

	// Health is public: no cookie needed.
	status, _, body := app.req(app.anon, "GET", "/health", nil)
	health := decode[api.Health](t, body)
	eq(t, status, 200)
	eq(t, fmt.Sprint(health.Status, " ", health.DB, " ", health.MQTT), "ok true true")

	// config.json (the browser's MQTT settings) is gone with browser MQTT.
	eq(t, app.status(app.http, "GET", "/config.json", nil), 404)
}

func TestRecordsAreGone(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)

	// No route: a plain 404, even when logged in.
	eq(t, app.status(app.http, "GET", "/api/records", nil), 404)
	eq(t, app.status(app.http, "POST", "/api/records", map[string]any{"value": "x"}), 404)
	// No tables or types: the last migration dropped them.
	var left []string
	rows, err := pool.Query(context.Background(),
		`SELECT name FROM unnest(ARRAY['records', 'record_events', 'record_op', 'connection_type']) AS name
		 WHERE to_regclass(name) IS NOT NULL OR to_regtype(name) IS NOT NULL`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		left = append(left, name)
	}
	if len(left) > 0 {
		t.Fatalf("still in the database: %v", left)
	}
}

func TestWebSocketPing(t *testing.T) {
	app := startApp(t, newDatabase(t))
	sock := app.ws()

	sock.send("p1", api.RequestPing{})
	ok, isOk := sock.response("p1").V.(api.RpcOk)
	if !isOk || ok.Data.V != (api.RpcPong{}) {
		t.Fatalf("%+v", ok)
	}

	// A malformed message and a records request are reported, not fatal.
	sock.sendRaw([]byte(`{"request_id":"bad","request":{"op":"nope"}}`))
	if !isError(sock.response("bad")) {
		t.Fatal("a malformed request worked")
	}
	sock.sendRaw([]byte(`{"request_id":"l1","request":{"op":"list"}}`))
	if !isError(sock.response("l1")) {
		t.Fatal("a records request worked")
	}
	sock.send("p2", api.RequestPing{})
	if isError(sock.response("p2")) {
		t.Fatal("the socket broke after an error")
	}
}

func TestMQTTServerStatus(t *testing.T) {
	app := startApp(t, newDatabase(t))
	dev := app.mqttConnect()

	// The server's retained status.
	eq(t, string(dev.nextOn(mqtt.StatusTopic(app.prefix))), "online")

	// On a clean shutdown the server marks itself offline.
	app.shutdown()
	eq(t, string(dev.nextOn(mqtt.StatusTopic(app.prefix))), "offline")
}

func TestServesClientFilesUnderPrefix(t *testing.T) {
	dir := t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(dir+"/index.html", []byte("<!doctype html>index"), 0o644))
	must(os.WriteFile(dir+"/app.js", []byte("console.log(1)"), 0o644))
	must(os.Mkdir(dir+"/assets", 0o755))
	app := startAppWith(t, newDatabase(t), dir)

	get := func(path string) (*http.Response, string) {
		res, err := app.anon.Get(app.base + path)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res, string(b)
	}
	res, _ := get("/app")
	eq(t, res.StatusCode, 308)
	eq(t, res.Header.Get("Location"), "/app/")

	for _, path := range []string{"/app/", "/app/some/client/route", "/app/assets"} {
		res, body := get(path)
		if res.StatusCode != 200 || body != "<!doctype html>index" {
			t.Errorf("%s: %d %q", path, res.StatusCode, body)
		}
	}
	// Path traversal: the mux cleans the path and redirects, nothing is read outside the directory.
	res, body := get("/app/../../etc/passwd")
	if res.StatusCode == 200 || strings.Contains(body, "root:") {
		t.Errorf("traversal: %d %q", res.StatusCode, body)
	}
	_, body = get("/app/app.js")
	eq(t, body, "console.log(1)")
	res, _ = get("/app/api/nope")
	eq(t, res.StatusCode, 404)
	res, _ = get("/elsewhere")
	eq(t, res.StatusCode, 404)
}

// ---- Login and sessions ---------------------------------------------------------------

func TestMigrationsAdoptASqlxDatabase(t *testing.T) {
	pool := newDatabase(t) // fully migrated by goose
	ctx := context.Background()
	for _, stmt := range []string{
		`DROP TABLE goose_db_version`,
		`CREATE TABLE _sqlx_migrations (version bigint PRIMARY KEY, description text NOT NULL,
		   installed_on timestamptz NOT NULL DEFAULT now(), success boolean NOT NULL,
		   checksum bytea NOT NULL, execution_time bigint NOT NULL)`,
		`INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES
		   (20261018000000, 'init', true, '\x00', 1), (20261019000000, 'auth', true, '\x00', 1),
		   (20261020000000, 'client ip', true, '\x00', 1)`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("adopting failed: %v", err)
	}
	var applied int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM goose_db_version WHERE is_applied AND version_id > 0`).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	// The three it adopted, plus the ones after them.
	eq(t, applied, 4)
	// Running again does nothing, and the old table is still there.
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	eq(t, count(t, pool, "_sqlx_migrations"), 3)
}
