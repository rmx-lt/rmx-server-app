//go:build integration

// The harness of the integration tests against a real TimescaleDB and
// Mosquitto; the tests themselves are one file per domain (auth_test.go,
// firmware_test.go) plus app_test.go for what the app wires together.
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
package integration

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
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

	"github.com/rmx-lt/rmx-server-app/internal/api"
	appserver "github.com/rmx-lt/rmx-server-app/internal/app"
	"github.com/rmx-lt/rmx-server-app/internal/auth"
	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/db"
	"github.com/rmx-lt/rmx-server-app/internal/mqtt"
)

const (
	wait = 5 * time.Second
	// origin is the page origin the tests pretend to be (in ALLOWED_ORIGINS).
	origin   = "http://app.test"
	user     = "tester"
	password = "correct horse battery staple"
	cookie   = "__Secure-app_session"
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
func newDatabase(t *testing.T) *db.Pool {
	t.Helper()
	ctx := context.Background()
	base := os.Getenv("DATABASE_URL")
	if base == "" {
		t.Fatal("DATABASE_URL is not set (copy .env.example to .env and start the compose stack)")
	}
	admin, err := db.Connect(ctx, base, 2)
	if err != nil {
		t.Fatal(err)
	}
	name := "app_it_" + randomHex(6)
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
	pool   *db.Pool
	// http is logged in as user, and sends Origin: origin.
	http *http.Client
	// cookie is the name=value session cookie of http.
	cookie string
	// anon sends no cookie and no Origin.
	anon *http.Client
	stop context.CancelFunc
	done chan error
}

func startApp(t *testing.T, pool *db.Pool) *testApp { return startAppWith(t, pool, "") }

type appOptions struct {
	staticDir   string
	firmwareDir string
}

func startAppWith(t *testing.T, pool *db.Pool, staticDir string) *testApp {
	return startAppOptions(t, pool, appOptions{staticDir: staticDir})
}

func startAppOptions(t *testing.T, pool *db.Pool, opts appOptions) *testApp {
	t.Helper()
	prefix := "mower/it-" + randomHex(8)
	cfg, err := config.FromLookup(func(key string) (string, bool) {
		switch key {
		case "MQTT_TOPIC_PREFIX":
			return prefix, true
		case "MQTT_CLIENT_ID":
			return "server-" + strings.ReplaceAll(prefix, "/", "-"), true
		case "STATIC_DIR":
			return opts.staticDir, opts.staticDir != ""
		case "FIRMWARE_DIR":
			return opts.firmwareDir, opts.firmwareDir != ""
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
	go func() { app.done <- appserver.Serve(ctx, cfg, pool, ln) }()
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

func (a *testApp) url(path string) string { return a.base + "/app" + path }

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

// login does POST /app/api/auth/login from an allowed origin, without a cookie.
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
	body, _ := json.Marshal(api.RequestEnvelope{RequestID: requestID, Request: api.Request{V: req}})
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

func (w *ws) next() api.ServerMessage {
	w.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	_, data, err := w.c.Read(ctx)
	if err != nil {
		w.t.Fatalf("websocket message in time: %v", err)
	}
	return decode[api.ServerMessage](w.t, data)
}

// response is the result for requestID.
func (w *ws) response(requestID string) api.RpcResult {
	w.t.Helper()
	m, ok := w.next().V.(api.MsgResponse)
	if !ok {
		w.t.Fatal("expected a response")
	}
	eq(w.t, m.Response.RequestID, requestID)
	return m.Response.Result
}

// ---- MQTT client ------------------------------------------------------------------

type message struct {
	topic   string
	payload []byte
}

// mqttDevice is a device-like MQTT client (like the LTE gateway) logged in as test-device.
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
		ConnectUsername:               "test-device",
		ConnectPassword:               []byte(os.Getenv("TEST_DEVICE_PASSWORD")),
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
	subs := []paho.SubscribeOptions{{Topic: mqtt.StatusTopic(a.prefix), QoS: 1}}
	if _, err := cm.Subscribe(ctx, &paho.Subscribe{Subscriptions: subs}); err != nil {
		t.Fatal(err)
	}
	return d
}

// topic is <prefix>/<this device>/<suffix>.
func (d *mqttDevice) topic(suffix string) string {
	return mqtt.DeviceTopic(d.prefix, core.DeviceID(d.id), suffix)
}

func (d *mqttDevice) publish(topic string, payload []byte) {
	d.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	_, err := d.cm.Publish(ctx, &paho.Publish{Topic: topic, QoS: 1, Payload: payload})
	if err != nil {
		d.t.Fatal(err)
	}
}

func (d *mqttDevice) subscribe(topics ...string) {
	d.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	for _, topic := range topics {
		if _, err := d.cm.Subscribe(ctx, &paho.Subscribe{Subscriptions: []paho.SubscribeOptions{{Topic: topic, QoS: 1}}}); err != nil {
			d.t.Fatal(err)
		}
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

// ---- helpers ------------------------------------------------------------------------

func isError(r api.RpcResult) bool {
	_, ok := r.V.(api.RpcError)
	return ok
}

func count(t *testing.T, pool *db.Pool, table string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
