//go:build integration

// Integration tests against a real TimescaleDB and Mosquitto.
//
// They need the dev compose stack (docker compose -f compose.dev.yaml up -d --wait)
// and the settings from .env, then:
//
//	go test -tags integration ./...
//
// Every test gets its own fresh, migrated database, and its own MQTT topic
// prefix, so tests can run in parallel. startApp also creates a user and logs
// in, so app.http and app.ws() are a logged-in browser on an allowed origin;
// app.anon is a client without cookie or Origin.
package server_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rmx-lt/rmx-backend-probe/internal/auth"
	"github.com/rmx-lt/rmx-backend-probe/internal/config"
	"github.com/rmx-lt/rmx-backend-probe/internal/db"
	"github.com/rmx-lt/rmx-backend-probe/internal/protocol"
	"github.com/rmx-lt/rmx-backend-probe/internal/server"
)

const (
	wait = 5 * time.Second
	// origin is the page origin the tests pretend to be (in ALLOWED_ORIGINS).
	origin   = "http://probe.test"
	user     = "tester"
	password = "correct horse battery staple"
	cookie   = "__Secure-probe_session"
)

func TestMain(m *testing.M) {
	if os.Getenv("LOG_LEVEL") == "debug" {
		slog.SetLogLoggerLevel(slog.LevelDebug)
	}
	config.LoadDotenv("../../.env")
	os.Exit(m.Run())
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// newDatabase creates a fresh database, migrates it and returns a pool on it.
func newDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	base := os.Getenv("DATABASE_URL")
	if base == "" {
		t.Fatal("DATABASE_URL is not set (copy .env.example to .env and start the compose stack)")
	}
	admin, err := pgxpool.New(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	name := "probe_it_" + randomHex(6)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP DATABASE "+name+" WITH (FORCE)")
		admin.Close()
	})
	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	pool, err := db.Connect(ctx, u.String(), 5)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return pool
}

// headers adds fixed headers to every request.
type headers map[string]string

func (h headers) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	for k, v := range h {
		r.Header.Set(k, v)
	}
	return http.DefaultTransport.RoundTrip(r)
}

// client sends these cookie and Origin headers on every request (nil: none).
func client(cookieHeader, originHeader string) *http.Client {
	h := headers{}
	if cookieHeader != "" {
		h["Cookie"] = cookieHeader
	}
	if originHeader != "" {
		h["Origin"] = originHeader
	}
	return &http.Client{Transport: h, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

type testApp struct {
	t      *testing.T
	base   string
	prefix string
	pool   *pgxpool.Pool
	// http is logged in as user, and sends Origin: origin.
	http *http.Client
	// cookie is the name=value session cookie of http.
	cookie string
	// anon sends no cookie and no Origin.
	anon *http.Client
	stop context.CancelFunc
	done chan error
}

func startApp(t *testing.T, pool *pgxpool.Pool) *testApp { return startAppWith(t, pool, "") }

func startAppWith(t *testing.T, pool *pgxpool.Pool, staticDir string) *testApp {
	t.Helper()
	prefix := "mower/it-" + randomHex(8)
	cfg, err := config.FromLookup(func(key string) (string, bool) {
		switch key {
		case "MQTT_TOPIC_PREFIX":
			return prefix, true
		case "MQTT_CLIENT_ID":
			return "server-" + strings.ReplaceAll(prefix, "/", "-"), true
		case "STATIC_DIR":
			return staticDir, staticDir != ""
		case "ALLOWED_ORIGINS":
			return origin + ",http://other.allowed.test", true
		}
		return os.LookupEnv(key)
	})
	if err != nil {
		t.Fatalf("test config (is .env present?): %v", err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	app := &testApp{
		t: t, base: "http://" + ln.Addr().String(), prefix: prefix, pool: pool,
		anon: client("", ""), stop: cancel, done: make(chan error, 1),
	}
	go func() { app.done <- server.Serve(ctx, cfg, pool, ln) }()
	t.Cleanup(func() { app.shutdown() })

	app.waitHealthy()
	if err := auth.CreateUser(context.Background(), pool, user, password); err != nil {
		t.Fatal(err)
	}
	res := app.login(user, password)
	if res.StatusCode != 200 {
		t.Fatalf("login: %d", res.StatusCode)
	}
	app.cookie = sessionCookie(t, res)
	app.http = client(app.cookie, origin)
	return app
}

// shutdown stops the server and checks that it stops in time. It is safe to call twice.
func (a *testApp) shutdown() {
	a.stop()
	select {
	case err := <-a.done:
		if err != nil {
			a.t.Errorf("server stopped with an error: %v", err)
		}
		a.done <- nil
	case <-time.After(wait):
		a.t.Error("no graceful shutdown in time")
	}
}

func (a *testApp) url(path string) string { return a.base + "/probe" + path }

func (a *testApp) waitHealthy() {
	deadline := time.Now().Add(wait)
	for {
		if res, err := a.anon.Get(a.url("/health")); err == nil {
			res.Body.Close()
			if res.StatusCode == 200 {
				return
			}
		}
		if time.Now().After(deadline) {
			a.t.Fatal("server not healthy in time")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// login does POST /probe/api/auth/login from an allowed origin, without a cookie.
func (a *testApp) login(username, pw string) *http.Response {
	a.t.Helper()
	return a.loginAs(a.anon, username, pw)
}

func (a *testApp) loginAs(c *http.Client, username, pw string) *http.Response {
	a.t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": pw})
	req, _ := http.NewRequest("POST", a.url("/api/auth/login"), bytes.NewReader(body))
	req.Header.Set("Origin", origin)
	res, err := c.Do(req)
	if err != nil {
		a.t.Fatal(err)
	}
	return res
}

// req sends a request with c and returns the response with its body read.
func (a *testApp) req(c *http.Client, method, path string, body any, hdr ...string) (int, http.Header, []byte) {
	a.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, a.url(path), r)
	if err != nil {
		a.t.Fatal(err)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := c.Do(req)
	if err != nil {
		a.t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return res.StatusCode, res.Header, data
}

func (a *testApp) status(c *http.Client, method, path string, body any, hdr ...string) int {
	a.t.Helper()
	s, _, _ := a.req(c, method, path, body, hdr...)
	return s
}

func sessionCookie(t *testing.T, res *http.Response) string {
	t.Helper()
	set := res.Header.Get("Set-Cookie")
	pair, _, _ := strings.Cut(set, ";")
	if !strings.HasPrefix(pair, cookie+"=") {
		t.Fatalf("Set-Cookie: %q", set)
	}
	return pair
}

func decode[T any](t *testing.T, data []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("%v in %s", err, data)
	}
	return v
}

func str(s string) *string { return &s }

func sameJSON(t *testing.T, got, want any) {
	t.Helper()
	g, _ := json.Marshal(got)
	w, _ := json.Marshal(want)
	if string(g) != string(w) {
		t.Fatalf("got  %s\nwant %s", g, w)
	}
}

func eq[T comparable](t *testing.T, got, want T) {
	t.Helper()
	if got != want {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// ---- WebSocket client -----------------------------------------------------------

type ws struct {
	t *testing.T
	c *websocket.Conn
}

func (a *testApp) wsWith(cookieHeader, originHeader string) (*ws, int) {
	a.t.Helper()
	h := http.Header{}
	if cookieHeader != "" {
		h.Set("Cookie", cookieHeader)
	}
	if originHeader != "" {
		h.Set("Origin", originHeader)
	}
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	c, res, err := websocket.Dial(ctx, strings.Replace(a.url("/ws"), "http", "ws", 1), &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		if res != nil {
			return nil, res.StatusCode
		}
		a.t.Fatal(err)
	}
	a.t.Cleanup(func() { c.CloseNow() })
	return &ws{a.t, c}, 101
}

// ws opens a logged-in WebSocket from an allowed origin.
func (a *testApp) ws() *ws {
	a.t.Helper()
	w, status := a.wsWith(a.cookie, origin)
	eq(a.t, status, 101)
	return w
}

func (w *ws) send(requestID string, req any) {
	w.t.Helper()
	body, _ := json.Marshal(protocol.RequestEnvelope{RequestID: requestID, Request: protocol.Request{V: req}})
	w.sendRaw(body)
}

func (w *ws) sendRaw(body []byte) {
	w.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	if err := w.c.Write(ctx, websocket.MessageText, body); err != nil {
		w.t.Fatal(err)
	}
}

func (w *ws) next() protocol.ServerMessage {
	w.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	_, data, err := w.c.Read(ctx)
	if err != nil {
		w.t.Fatalf("websocket message in time: %v", err)
	}
	return decode[protocol.ServerMessage](w.t, data)
}

// response is the result for requestID, skipping events.
func (w *ws) response(requestID string) protocol.RpcResult {
	w.t.Helper()
	for {
		if m, ok := w.next().V.(protocol.MsgResponse); ok {
			eq(w.t, m.Response.RequestID, requestID)
			return m.Response.Result
		}
	}
}

// event is the next change event, skipping responses.
func (w *ws) event() protocol.ChangeEvent {
	w.t.Helper()
	for {
		if m, ok := w.next().V.(protocol.MsgEvent); ok {
			return m.Event
		}
	}
}

// ---- MQTT client ------------------------------------------------------------------

type message struct {
	topic   string
	payload []byte
}

// mqttDevice is a device-like MQTT client (like the LTE modem probe) logged in as probe-device.
type mqttDevice struct {
	t        *testing.T
	cm       *autopaho.ConnectionManager
	id       string
	prefix   string
	received chan message
	buffered []message
}

func (a *testApp) mqttConnect() *mqttDevice {
	a.t.Helper()
	t := a.t
	port, _ := strconv.Atoi(os.Getenv("MQTT_PORT"))
	d := &mqttDevice{t: t, id: "it-" + randomHex(6), prefix: a.prefix, received: make(chan message, 64)}
	up := make(chan struct{}, 1)
	cm, err := autopaho.NewConnection(context.Background(), autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{{Scheme: "mqtt", Host: net.JoinHostPort(os.Getenv("MQTT_HOST"), strconv.Itoa(port))}},
		ConnectUsername:               "probe-device",
		ConnectPassword:               []byte(os.Getenv("PROBE_DEVICE_PASSWORD")),
		KeepAlive:                     30,
		CleanStartOnInitialConnection: true,
		OnConnectionUp:                func(*autopaho.ConnectionManager, *paho.Connack) { up <- struct{}{} },
		OnConnectError:                func(err error) { t.Logf("device connect: %v", err) },
		ClientConfig: paho.ClientConfig{
			ClientID: d.id,
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){
				func(pr paho.PublishReceived) (bool, error) {
					d.received <- message{pr.Packet.Topic, pr.Packet.Payload}
					return true, nil
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	d.cm = cm
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = cm.Disconnect(ctx)
	})
	select {
	case <-up:
	case <-time.After(wait):
		t.Fatal("device did not connect to the broker")
	}
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	for _, topic := range []string{
		protocol.ResponseTopic(a.prefix, d.id), protocol.EventsTopic(a.prefix), protocol.StatusTopic(a.prefix),
	} {
		if _, err := cm.Subscribe(ctx, &paho.Subscribe{Subscriptions: []paho.SubscribeOptions{{Topic: topic, QoS: 1}}}); err != nil {
			t.Fatal(err)
		}
	}
	return d
}

func (d *mqttDevice) send(requestID string, req any) {
	d.t.Helper()
	body, _ := json.Marshal(protocol.RequestEnvelope{RequestID: requestID, Request: protocol.Request{V: req}})
	d.sendRaw(body)
}

func (d *mqttDevice) sendRaw(payload []byte) {
	d.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	_, err := d.cm.Publish(ctx, &paho.Publish{Topic: protocol.RequestTopic(d.prefix, d.id), QoS: 1, Payload: payload})
	if err != nil {
		d.t.Fatal(err)
	}
}

// nextOn is the next message on topic. Messages on other topics are kept for later.
func (d *mqttDevice) nextOn(topic string) []byte {
	d.t.Helper()
	for i, m := range d.buffered {
		if m.topic == topic {
			d.buffered = append(d.buffered[:i], d.buffered[i+1:]...)
			return m.payload
		}
	}
	for {
		select {
		case m := <-d.received:
			if m.topic == topic {
				return m.payload
			}
			d.buffered = append(d.buffered, m)
		case <-time.After(wait):
			d.t.Fatalf("no message on %s in time", topic)
		}
	}
}

func (d *mqttDevice) response() protocol.ResponseEnvelope {
	d.t.Helper()
	return decode[protocol.ResponseEnvelope](d.t, d.nextOn(protocol.ResponseTopic(d.prefix, d.id)))
}

func (d *mqttDevice) event() protocol.ChangeEvent {
	d.t.Helper()
	return decode[protocol.ChangeEvent](d.t, d.nextOn(protocol.EventsTopic(d.prefix)))
}

// ---- helpers ------------------------------------------------------------------------

func record(t *testing.T, r protocol.RpcResult) protocol.RecordRow {
	t.Helper()
	if ok, isOk := r.V.(protocol.RpcOk); isOk {
		if rec, isRec := ok.Data.V.(protocol.RpcRecord); isRec {
			return rec.Record
		}
	}
	t.Fatalf("expected a record, got %+v", r)
	return protocol.RecordRow{}
}

func records(t *testing.T, r protocol.RpcResult) []protocol.RecordRow {
	t.Helper()
	if ok, isOk := r.V.(protocol.RpcOk); isOk {
		if list, isList := ok.Data.V.(protocol.RpcRecords); isList {
			return list.Records
		}
	}
	t.Fatalf("expected a list, got %+v", r)
	return nil
}

func isError(r protocol.RpcResult) bool {
	_, ok := r.V.(protocol.RpcError)
	return ok
}

// eventOps returns "op connection_type" for every logged event of the record, oldest first.
func eventOps(t *testing.T, pool *pgxpool.Pool, id int64) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT op::text || ' ' || connection_type::text FROM record_events WHERE record_id = $1 ORDER BY time`, id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ops []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		ops = append(ops, s)
	}
	return ops
}

func count(t *testing.T, pool *pgxpool.Pool, table string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func sameStrings(t *testing.T, got, want []string) {
	t.Helper()
	eq(t, strings.Join(got, ", "), strings.Join(want, ", "))
}

// ---- Tests --------------------------------------------------------------------------

func TestRESTCRUDHealthAndConfig(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)

	// Health is public: no cookie needed.
	status, _, body := app.req(app.anon, "GET", "/health", nil)
	health := decode[protocol.Health](t, body)
	eq(t, status, 200)
	eq(t, fmt.Sprint(health.Status, " ", health.DB, " ", health.MQTT), "ok true true")

	// config.json (the browser's MQTT settings) is gone with browser MQTT.
	eq(t, app.status(app.http, "GET", "/config.json", nil), 404)

	// Create
	status, _, body = app.req(app.http, "POST", "/api/records", map[string]any{"value": "hello"})
	eq(t, status, 201)
	created := decode[protocol.RecordRow](t, body)
	eq(t, *created.Value, "hello")
	eq(t, created.ConnectionType, protocol.ConnHTTPS)

	// List
	_, _, body = app.req(app.http, "GET", "/api/records", nil)
	sameJSON(t, decode[[]protocol.RecordRow](t, body), []protocol.RecordRow{created})

	// Update (to null)
	status, _, body = app.req(app.http, "PUT", fmt.Sprintf("/api/records/%d", created.ID), map[string]any{"value": nil})
	eq(t, status, 200)
	updated := decode[protocol.RecordRow](t, body)
	if updated.Value != nil || !updated.UpdatedAt.After(created.UpdatedAt) {
		t.Fatalf("%+v", updated)
	}

	// Delete, then the record is gone
	path := fmt.Sprintf("/api/records/%d", created.ID)
	eq(t, app.status(app.http, "DELETE", path, nil), 204)
	eq(t, app.status(app.http, "DELETE", path, nil), 404)
	status, _, body = app.req(app.http, "PUT", path, map[string]any{"value": "x"})
	eq(t, status, 404)
	eq(t, decode[map[string]string](t, body)["code"], "not_found")

	// Validation
	eq(t, app.status(app.http, "POST", "/api/records", map[string]any{"value": strings.Repeat("a", 1001)}), 400)
	eq(t, app.status(app.http, "POST", "/api/records", "not an object"), 400)
	eq(t, app.status(app.http, "PUT", "/api/records/abc", map[string]any{"value": "x"}), 400)

	// Every change is in the hypertable log
	sameStrings(t, eventOps(t, pool, created.ID), []string{"create https", "update https", "delete https"})
}

func TestWSSCRUDAndLiveEvents(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)
	a, b := app.ws(), app.ws()

	a.send("c1", protocol.RequestCreate{Value: str("ws")})
	created := record(t, a.response("c1"))
	eq(t, created.ConnectionType, protocol.ConnWSS)
	// The other client sees the change live.
	sameJSON(t, b.event(), protocol.ChangeEvent{V: protocol.EventCreate{Record: created}})

	a.send("u1", protocol.RequestUpdate{ID: created.ID, Value: str("ws2")})
	updated := record(t, a.response("u1"))
	sameJSON(t, b.event(), protocol.ChangeEvent{V: protocol.EventUpdate{Record: updated}})

	a.send("l1", protocol.RequestList{})
	eq(t, len(records(t, a.response("l1"))), 1)

	a.send("d1", protocol.RequestDelete{ID: created.ID})
	if _, ok := a.response("d1").V.(protocol.RpcOk); !ok {
		t.Fatal("delete failed")
	}
	sameJSON(t, b.event(), protocol.ChangeEvent{V: protocol.EventDelete{ID: created.ID, ConnectionType: protocol.ConnWSS}})

	// A missing record and a malformed message are reported, not fatal.
	a.send("d2", protocol.RequestDelete{ID: created.ID})
	if !isError(a.response("d2")) {
		t.Fatal("deleting a missing record worked")
	}
	a.sendRaw([]byte(`{"request_id":"bad","request":{"op":"nope"}}`))
	if !isError(a.response("bad")) {
		t.Fatal("a malformed request worked")
	}

	// A change over REST also reaches WebSocket clients.
	_, _, body := app.req(app.http, "POST", "/api/records", map[string]any{"value": "from rest"})
	rest := decode[protocol.RecordRow](t, body)
	sameJSON(t, b.event(), protocol.ChangeEvent{V: protocol.EventCreate{Record: rest}})

	sameStrings(t, eventOps(t, pool, created.ID), []string{"create wss", "update wss", "delete wss"})
}

func TestMQTTCRUDAndLiveEvents(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)
	dev := app.mqttConnect()
	sock := app.ws()

	// The server's retained status.
	eq(t, string(dev.nextOn(protocol.StatusTopic(app.prefix))), "online")

	dev.send("c1", protocol.RequestCreate{})
	res := dev.response()
	eq(t, res.RequestID, "c1")
	created := record(t, res.Result)
	eq(t, created.ConnectionType, protocol.ConnMQTT)
	// Broadcast on the MQTT events topic and over the WebSocket.
	sameJSON(t, dev.event(), protocol.ChangeEvent{V: protocol.EventCreate{Record: created}})
	sameJSON(t, sock.event(), protocol.ChangeEvent{V: protocol.EventCreate{Record: created}})

	dev.send("u1", protocol.RequestUpdate{ID: created.ID, Value: str("m")})
	updated := record(t, dev.response().Result)
	eq(t, *updated.Value, "m")
	sameJSON(t, dev.event(), protocol.ChangeEvent{V: protocol.EventUpdate{Record: updated}})

	dev.send("l1", protocol.RequestList{})
	eq(t, len(records(t, dev.response().Result)), 1)

	dev.send("d1", protocol.RequestDelete{ID: created.ID})
	if _, ok := dev.response().Result.V.(protocol.RpcOk); !ok {
		t.Fatal("delete failed")
	}
	sameJSON(t, dev.event(), protocol.ChangeEvent{V: protocol.EventDelete{ID: created.ID, ConnectionType: protocol.ConnMQTT}})

	// Malformed payload: an error response, keeping the request id.
	dev.sendRaw([]byte(`{"request_id":"bad","request":{}}`))
	res = dev.response()
	eq(t, res.RequestID, "bad")
	if !isError(res.Result) {
		t.Fatal("a malformed request worked")
	}

	// A WebSocket change reaches MQTT clients.
	sock.send("w1", protocol.RequestCreate{Value: str("from ws")})
	fromWS := record(t, sock.response("w1"))
	sameJSON(t, dev.event(), protocol.ChangeEvent{V: protocol.EventCreate{Record: fromWS}})

	sameStrings(t, eventOps(t, pool, created.ID), []string{"create mqtt", "update mqtt", "delete mqtt"})

	// On a clean shutdown the server marks itself offline.
	app.shutdown()
	eq(t, string(dev.nextOn(protocol.StatusTopic(app.prefix))), "offline")
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
	res, _ := get("/probe")
	eq(t, res.StatusCode, 308)
	eq(t, res.Header.Get("Location"), "/probe/")

	for _, path := range []string{"/probe/", "/probe/some/client/route", "/probe/assets"} {
		res, body := get(path)
		if res.StatusCode != 200 || body != "<!doctype html>index" {
			t.Errorf("%s: %d %q", path, res.StatusCode, body)
		}
	}
	// Path traversal: the mux cleans the path and redirects, nothing is read outside the directory.
	res, body := get("/probe/../../etc/passwd")
	if res.StatusCode == 200 || strings.Contains(body, "root:") {
		t.Errorf("traversal: %d %q", res.StatusCode, body)
	}
	_, body = get("/probe/app.js")
	eq(t, body, "console.log(1)")
	res, _ = get("/probe/api/nope")
	eq(t, res.StatusCode, 404)
	res, _ = get("/elsewhere")
	eq(t, res.StatusCode, 404)
}

// ---- Login and sessions ---------------------------------------------------------------

func TestLoginMeAndLogout(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)

	// The login set a cookie with all the protective attributes.
	res := app.login("Tester", password) // usernames ignore case
	eq(t, res.StatusCode, 200)
	eq(t, res.Header.Get("Cache-Control"), "no-store")
	set := res.Header.Get("Set-Cookie")
	for _, attr := range []string{"Path=/probe", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=2592000"} {
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
	eq(t, app.status(app.http, "GET", "/api/records", nil), 401)
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
		for _, path := range []string{"/api/records", "/api/auth/me"} {
			status, _, body := app.req(cl, "GET", path, nil)
			eq(t, status, 401)
			eq(t, decode[map[string]string](t, body)["code"], "unauthorized")
		}
		eq(t, app.status(cl, "POST", "/api/records", map[string]any{"value": "x"}), 401)
		eq(t, app.status(cl, "POST", "/api/auth/logout-all", nil), 401)
		_, wsStatus := app.wsWith(c, origin)
		eq(t, wsStatus, 401)
	}
	// Nothing was created by the refused requests.
	eq(t, count(t, pool, "records"), 0)

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

	for _, o := range []string{"https://evil.example", "http://probe.test.evil.example", "null", ""} {
		// Logged in, but the request comes from another site's page (CSRF).
		c := client(app.cookie, o)
		status, _, body := app.req(c, "POST", "/api/records", map[string]any{"value": "csrf"})
		eq(t, status, 403)
		eq(t, decode[map[string]string](t, body)["code"], "forbidden")
		eq(t, app.status(c, "DELETE", "/api/records/1", nil), 403)
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
	eq(t, count(t, pool, "records"), 0)

	// Reading needs no Origin (browsers don't always send it on GET), and
	// every origin in ALLOWED_ORIGINS works.
	eq(t, app.status(client(app.cookie, ""), "GET", "/api/records", nil), 200)
	eq(t, app.status(client(app.cookie, "http://other.allowed.test"), "POST", "/api/records", map[string]any{"value": "ok"}), 201)
	sock := app.ws()
	sock.send("l1", protocol.RequestList{})
	records(t, sock.response("l1"))
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

// ---- Who created a record --------------------------------------------------------------

func TestRecordsRememberTheCreatorIP(t *testing.T) {
	pool := newDatabase(t)
	app := startApp(t, pool)
	ipOf := func(id int64) []string {
		rows, err := pool.Query(context.Background(),
			`SELECT op::text || ' ' || coalesce(host(ip), '-') FROM record_events WHERE record_id = $1 ORDER BY time`, id)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var s string
			_ = rows.Scan(&s)
			out = append(out, s)
		}
		return out
	}
	create := func(hdr ...string) protocol.RecordRow {
		_, _, body := app.req(app.http, "POST", "/api/records", map[string]any{"value": "x"}, hdr...)
		return decode[protocol.RecordRow](t, body)
	}

	// REST without a proxy: the TCP peer.
	direct := create()
	eq(t, *direct.CreatedIP, "127.0.0.1")

	// REST behind Caddy: the last X-Forwarded-For entry (what Caddy saw).
	proxied := create("X-Forwarded-For", "198.51.100.1, 203.0.113.7")
	eq(t, *proxied.CreatedIP, "203.0.113.7")

	// An update by someone else keeps the creator's IP in the record, and the
	// event log has who did what.
	_, _, body := app.req(app.http, "PUT", fmt.Sprintf("/api/records/%d", proxied.ID),
		map[string]any{"value": "changed"}, "X-Forwarded-For", "2001:db8::5")
	eq(t, *decode[protocol.RecordRow](t, body).CreatedIP, "203.0.113.7")
	sameStrings(t, ipOf(proxied.ID), []string{"create 203.0.113.7", "update 2001:db8::5"})

	// WSS: the IP of the handshake.
	sock := app.ws()
	sock.send("c1", protocol.RequestCreate{Value: str("ws")})
	eq(t, *record(t, sock.response("c1")).CreatedIP, "127.0.0.1")

	// MQTT: unknown (the broker doesn't pass on the client's address).
	dev := app.mqttConnect()
	dev.send("m1", protocol.RequestCreate{})
	overMQTT := record(t, dev.response().Result)
	if overMQTT.CreatedIP != nil {
		t.Fatal("an MQTT record has an IP")
	}
	sameStrings(t, ipOf(overMQTT.ID), []string{"create -"})

	// The list carries it too.
	_, _, body = app.req(app.http, "GET", "/api/records", nil)
	var ips []string
	for _, r := range decode[[]protocol.RecordRow](t, body) {
		if r.CreatedIP == nil {
			ips = append(ips, "-")
		} else {
			ips = append(ips, *r.CreatedIP)
		}
	}
	sameStrings(t, ips, []string{"-", "127.0.0.1", "203.0.113.7", "127.0.0.1"})
}

// ---- Migrations ---------------------------------------------------------------------------

// A database the Rust version of the probe migrated (recorded in _sqlx_migrations)
// is adopted without running the migrations again.
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
	eq(t, applied, 3)
	// Running again does nothing, and the old table is still there.
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	eq(t, count(t, pool, "_sqlx_migrations"), 3)
}
