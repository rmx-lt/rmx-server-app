//go:build integration

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
)

// Devsim against the real Mosquitto of the compose stack, with the test playing
// the server as wiki Mower-Protocol defines it: it publishes the retained
// mower/status/server, sends commands and live-driving setpoints, and serves
// chunk requests on the path and firmware topics. The server itself (issue 92)
// does not do these yet, which is why this plays its part.
//
//	docker compose -f compose.dev.yaml up -d --wait
//	go test -tags integration -count=1 ./cmd/devsim

type recorded struct {
	topic   string // relative to <prefix>/<name>/
	payload []byte
	retain  bool
	at      time.Time
}

type serverRole struct {
	t      *testing.T
	b      broker
	name   string
	base   string
	cm     *autopaho.ConnectionManager
	ctx    context.Context
	mu     sync.Mutex
	got    []recorded
	files  map[string][]byte // "path/<file>", "gw-fw/<file>"
	ctlURL string
	nextID int
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

// startE2E starts devsim and the server's part on a private topic prefix.
func startE2E(t *testing.T, mutate func(*simConfig)) *serverRole {
	t.Helper()
	if os.Getenv("MQTT_HOST") == "" {
		t.Skip("no broker settings (copy .env.example to .env and start the compose stack)")
	}
	b := broker{host: os.Getenv("MQTT_HOST"), port: env("MQTT_PORT", "11883"), prefix: "mower/e2e-" + randHex(4)}
	name := "sim-" + randHex(3)
	ctx, cancel := context.WithCancel(context.Background())
	s := &serverRole{t: t, b: b, name: name, base: b.prefix + "/" + name + "/", ctx: ctx, files: map[string][]byte{}}
	t.Cleanup(cancel)

	acfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{{Scheme: "mqtt", Host: net.JoinHostPort(b.host, b.port)}},
		ConnectUsername:               env("MQTT_USERNAME", "app"),
		ConnectPassword:               []byte(env("MQTT_PASSWORD", "app-dev")),
		KeepAlive:                     30,
		CleanStartOnInitialConnection: true,
		OnConnectError:                func(err error) { t.Logf("server role: %v", err) },
		ClientConfig: paho.ClientConfig{
			ClientID: "e2e-server-" + randHex(4),
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){func(pr paho.PublishReceived) (bool, error) {
				s.receive(pr.Packet.Topic, pr.Packet.Payload, pr.Packet.Retain)
				return true, nil
			}},
		},
	}
	cm, err := autopaho.NewConnection(ctx, acfg)
	if err != nil {
		t.Fatal(err)
	}
	s.cm = cm
	cctx, ccancel := context.WithTimeout(ctx, 10*time.Second)
	defer ccancel()
	if err := cm.AwaitConnection(cctx); err != nil {
		t.Fatalf("cannot reach the broker (docker compose -f compose.dev.yaml up -d --wait): %v", err)
	}
	if _, err := cm.Subscribe(cctx, &paho.Subscribe{Subscriptions: []paho.SubscribeOptions{{Topic: s.base + "#", QoS: 1}}}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Leave no retained messages behind on the shared broker.
		for _, topic := range []string{b.prefix + "/status/server"} {
			s.publish(topic, nil, true)
		}
		s.clearRetained()
	})

	cfg := simConfig{prefix: b.prefix, name: name, gwPeriod: 2 * time.Second, gwRestart: time.Second, apRestart: time.Second,
		linkLost: 3 * time.Second, fixGrace: time.Second}
	if mutate != nil {
		mutate(&cfg)
	}
	s.ctlURL = freeAddr(t)
	done := make(chan error, 1)
	go func() { done <- simulate(ctx, b, cfg, s.ctlURL, nil) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
	})
	return s
}

func (s *serverRole) clearRetained() {
	s.mu.Lock()
	var topics []string
	for _, m := range s.got {
		if m.retain {
			topics = append(topics, s.base+m.topic)
		}
	}
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for _, t := range topics {
		_, _ = s.cm.Publish(ctx, &paho.Publish{Topic: t, QoS: 1, Retain: true})
	}
}

func (s *serverRole) publish(topic string, payload []byte, retain bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := s.cm.Publish(ctx, &paho.Publish{Topic: topic, QoS: 1, Retain: retain, Payload: payload}); err != nil && s.ctx.Err() == nil {
		s.t.Logf("publish %s: %v", topic, err)
	}
}

func (s *serverRole) serverOnline(on bool) {
	text := "offline"
	if on {
		text = "online"
	}
	s.publish(s.b.prefix+"/status/server", []byte(text), true)
}

// receive records what the mower published and answers chunk requests.
func (s *serverRole) receive(topic string, payload []byte, retain bool) {
	rel, ok := strings.CutPrefix(topic, s.base)
	if !ok {
		return
	}
	s.mu.Lock()
	s.got = append(s.got, recorded{rel, append([]byte(nil), payload...), retain, time.Now()})
	s.mu.Unlock()
	sets := map[string]struct{ set, chunk, res string }{
		"autopilot/path/req": {"path", "autopilot/path/chunk", "autopilot/path/res"},
		"gateway/fw/req":     {"gw-fw", "gateway/fw/chunk", "gateway/fw/res"},
	}
	if set, ok := sets[rel]; ok {
		go s.serveChunk(set.set, set.chunk, set.res, payload)
	}
}

func (s *serverRole) serveChunk(set, chunkTopic, resTopic string, payload []byte) {
	var req struct {
		RequestID string `json:"request_id"`
		File      string
		Chunk     int
	}
	if json.Unmarshal(payload, &req) != nil {
		return
	}
	s.mu.Lock()
	file, ok := s.files[set+"/"+req.File]
	s.mu.Unlock()
	if !ok {
		res, _ := json.Marshal(map[string]any{"request_id": req.RequestID, "error": map[string]string{"code": "not_found", "message": "no such file"}})
		s.publish(s.base+resTopic, res, false)
		return
	}
	frames := buildFrames(req.RequestID, file)
	if req.Chunk < len(frames) {
		s.publish(s.base+chunkTopic, frames[req.Chunk], false)
	}
}

// matching returns the recorded messages on a topic that satisfy ok.
func (s *serverRole) matching(topic string, ok func(map[string]any) bool) []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]any
	for _, m := range s.got {
		if m.topic != topic {
			continue
		}
		var v map[string]any
		if json.Unmarshal(m.payload, &v) != nil {
			continue
		}
		if ok == nil || ok(v) {
			out = append(out, v)
		}
	}
	return out
}

func (s *serverRole) waitFor(what string, timeout time.Duration, cond func() bool) {
	s.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	s.t.Fatalf("timed out waiting for %s", what)
}

func (s *serverRole) cmd(board, id, cmd string, params ...string) {
	body := fmt.Sprintf(`{"id":%q,"cmd":%q,"expires_at":%d`, id, cmd, time.Now().Add(time.Minute).Unix())
	for _, p := range params {
		body += "," + p
	}
	s.publish(s.base+board+"/cmd", []byte(body+"}"), false)
}

func (s *serverRole) ackOf(board, id string) []map[string]any {
	return s.matching(board+"/cmd/ack", func(m map[string]any) bool { return m["id"] == id })
}

// final waits for the final ack of a command.
func (s *serverRole) final(board, id string, timeout time.Duration) map[string]any {
	s.t.Helper()
	var last map[string]any
	s.waitFor("the final ack of "+id, timeout, func() bool {
		for _, a := range s.ackOf(board, id) {
			if a["state"] == "done" || a["state"] == "failed" {
				last = a
				return true
			}
		}
		return false
	})
	return last
}

func (s *serverRole) send(board, id, cmd string, params ...string) map[string]any {
	s.cmd(board, id, cmd, params...)
	return s.final(board, id, 10*time.Second)
}

func (s *serverRole) drive(seq int, v, w float64) {
	body := fmt.Sprintf(`{"seq":%d,"time":%.3f,"v":%g,"w":%g}`, seq, float64(time.Now().UnixNano())/1e9, v, w)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _ = s.cm.Publish(ctx, &paho.Publish{Topic: s.base + "autopilot/drive", QoS: 0, Payload: []byte(body)})
}

// driveFor sends setpoints at 10 Hz.
func (s *serverRole) driveFor(seq *int, d time.Duration, v, w float64) {
	for t := time.Duration(0); t < d; t += 100 * time.Millisecond {
		*seq++
		s.drive(*seq, v, w)
		time.Sleep(100 * time.Millisecond)
	}
}

func (s *serverRole) ctl(name, value string) {
	s.t.Helper()
	resp, err := http.PostForm("http://"+s.ctlURL+"/switch", url.Values{"name": {name}, "value": {value}})
	if err != nil {
		s.t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		s.t.Fatalf("switch %s=%s: %s", name, value, resp.Status)
	}
}

// metric is the newest telemetry value of a board.
func (s *serverRole) metric(board, name string) (any, bool) {
	msgs := s.matching(board+"/telemetry", func(m map[string]any) bool {
		_, has := m["metrics"].(map[string]any)[name]
		return has
	})
	if len(msgs) == 0 {
		return nil, false
	}
	return msgs[len(msgs)-1]["metrics"].(map[string]any)[name], true
}

func (s *serverRole) eventNames() []string {
	var out []string
	for _, e := range s.matching("autopilot/event", nil) {
		out = append(out, e["event"].(string))
	}
	return out
}

// ---- the test ------------------------------------------------------------------------------

func TestMowerOverMQTT(t *testing.T) {
	s := startE2E(t, nil)

	// 1. Nothing but the presence is published until the server link is up (§4.2).
	s.waitFor("gateway/status online", 10*time.Second, func() bool {
		return s.hasStatus("online")
	})
	time.Sleep(500 * time.Millisecond)
	if len(s.matching("gateway/state", nil)) != 0 {
		t.Fatal("state published before the server was online")
	}
	s.serverOnline(true)
	s.waitFor("both states and catalogues", 10*time.Second, func() bool {
		return len(s.matching("gateway/state", nil)) > 0 && len(s.matching("autopilot/state", nil)) > 0 &&
			len(s.matching("autopilot/metrics/index", nil)) > 0 && len(s.matching("gateway/metrics/index", nil)) > 0
	})
	st := s.matching("autopilot/state", nil)[0]
	if st["mode"] != "idle" || st["protocol"] != "0.1" || st["boot"].(float64) < 1 {
		t.Fatalf("autopilot state %v", st)
	}
	s.waitFor("telemetry of both boards", 15*time.Second, func() bool {
		return len(s.matching("gateway/telemetry", nil)) > 0 && len(s.matching("autopilot/telemetry", nil)) > 0
	})

	t.Run("commands, acks and repeated ids", func(t *testing.T) {
		a := s.send("gateway", "g-ping", "ping")
		if a["state"] != "done" || a["result"].(map[string]any)["pong"] != s.name {
			t.Fatalf("ping: %v", a)
		}
		// A lost ack: the server sends again with the same id and gets the same ack.
		s.ctl("drop-acks", "1")
		s.cmd("autopilot", "a-1", "manual_start")
		time.Sleep(700 * time.Millisecond)
		if n := len(s.ackOf("autopilot", "a-1")); n != 0 {
			t.Fatalf("the ack was not lost: %d", n)
		}
		s.cmd("autopilot", "a-1", "manual_start") // the same id
		first := s.final("autopilot", "a-1", 5*time.Second)
		if first["state"] != "done" {
			t.Fatalf("%v", first)
		}
		s.cmd("autopilot", "a-1", "manual_start") // and again
		s.waitFor("the repeated ack", 5*time.Second, func() bool { return len(s.ackOf("autopilot", "a-1")) == 2 })
		acks := s.ackOf("autopilot", "a-1")
		if fmt.Sprint(acks[0]) != fmt.Sprint(acks[1]) {
			t.Fatalf("a repeated id got another ack: %v / %v", acks[0], acks[1])
		}
		if a := s.send("autopilot", "a-2", "manual_start"); a["error"] != "wrong_mode" {
			t.Fatalf("a new id in manual mode: %v", a)
		}
	})

	t.Run("live driving moves the mower and stops within 0.5 s", func(t *testing.T) {
		seq := 0
		s.driveFor(&seq, 2500*time.Millisecond, 0.4, 0)
		s.waitFor("telemetry with speed", 3*time.Second, func() bool {
			v, ok := s.metric("autopilot", "position.speed")
			return ok && v != nil && v.(float64) > 0.2
		})
		lastSetpoint := time.Now()
		s.waitFor("drive_timeout", 3*time.Second, func() bool {
			for _, n := range s.eventNames() {
				if n == "drive_timeout" {
					return true
				}
			}
			return false
		})
		var at time.Time
		s.mu.Lock()
		for _, m := range s.got {
			if m.topic == "autopilot/event" && bytes.Contains(m.payload, []byte("drive_timeout")) {
				at = m.at
			}
		}
		s.mu.Unlock()
		if d := at.Sub(lastSetpoint); d > 700*time.Millisecond {
			t.Fatalf("drive_timeout %v after the last setpoint, the contract says 0.5 s", d)
		}
		s.waitFor("speed 0 in telemetry", 3*time.Second, func() bool {
			v, ok := s.metric("autopilot", "position.speed")
			return ok && v != nil && v.(float64) == 0
		})
		// Position changed.
		lat0 := s.matching("autopilot/telemetry", func(m map[string]any) bool { return m["metrics"].(map[string]any)["position.lon"] != nil })
		first := lat0[0]["metrics"].(map[string]any)["position.lon"].(float64)
		last := lat0[len(lat0)-1]["metrics"].(map[string]any)["position.lon"].(float64)
		if last-first < 5e-6 {
			t.Fatalf("longitude went from %.8f to %.8f", first, last)
		}
	})

	t.Run("recording produces point batches", func(t *testing.T) {
		if a := s.send("autopilot", "r-start", "record_start", `"session":"r-e2e"`); a["state"] != "done" {
			t.Fatal(a)
		}
		seq := 100
		s.driveFor(&seq, 3*time.Second, 0.5, 0)
		a := s.send("autopilot", "r-stop", "record_stop")
		n := int(a["result"].(map[string]any)["index"].(float64))
		if n < 10 {
			t.Fatalf("%d points", n)
		}
		have := map[int]bool{}
		batches := 0
		for _, b := range s.matching("autopilot/recording", func(m map[string]any) bool { return m["session"] == "r-e2e" }) {
			batches++
			pts := b["points"].([]any)
			if len(pts) > 50 || b["fix"] != "rtk_fixed" {
				t.Fatalf("batch %v", b)
			}
			for i := range pts {
				have[int(b["index"].(float64))+i] = true
			}
		}
		for i := 0; i < n; i++ {
			if !have[i] {
				t.Fatalf("point %d of %d missing", i, n)
			}
		}
		if batches < 2 {
			t.Fatalf("%d batches", batches)
		}
		if a := s.send("autopilot", "m-stop", "manual_stop"); a["state"] != "done" {
			t.Fatal(a)
		}
	})

	t.Run("a path is downloaded over chunk transfer and followed", func(t *testing.T) {
		// Points are relative to where the mower is, from its telemetry.
		lat, _ := s.metric("autopilot", "position.lat")
		lon, _ := s.metric("autopilot", "position.lon")
		la, lo := lat.(float64), lon.(float64)
		pt := func(dn, de float64) [2]float64 {
			return [2]float64{la + dn/metresPerDeg, lo + de/(metresPerDeg*math.Cos(la*math.Pi/180))}
		}
		// One chunk of padding makes the file span several chunks.
		var pad [][2]float64
		for i := 0; i < 400; i++ {
			pad = append(pad, pt(0, 0))
		}
		file := pathFile("j-e2e",
			seg{"transit", append(pad, pt(0, 1.5))},
			seg{"edge", [][2]float64{pt(0, 1.5), pt(1.5, 1.5)}})
		if len(file) < 2*chunkSize {
			t.Fatalf("file of %d bytes", len(file))
		}
		s.mu.Lock()
		s.files["path/j-e2e.json"] = file
		s.mu.Unlock()
		s.cmd("autopilot", "j-1", "path_start", fmt.Sprintf(`"path":"j-e2e","size":%d,"sha256":%q`, len(file), shaHex(file)))
		s.waitFor("accepted", 5*time.Second, func() bool {
			for _, a := range s.ackOf("autopilot", "j-1") {
				if a["state"] == "accepted" {
					return true
				}
			}
			return false
		})
		s.waitFor("mode path with the path id", 5*time.Second, func() bool {
			ms := s.matching("autopilot/state", func(m map[string]any) bool { return m["mode"] == "path" && m["path"] == "j-e2e" })
			return len(ms) > 0
		})
		a := s.final("autopilot", "j-1", 30*time.Second)
		if a["state"] != "done" || int(a["result"].(map[string]any)["points"].(float64)) != 403 {
			t.Fatalf("path: %v", a)
		}
		// path.point advanced while it ran.
		var points []float64
		for _, m := range s.matching("autopilot/telemetry", func(m map[string]any) bool { return m["metrics"].(map[string]any)["path.point"] != nil }) {
			points = append(points, m["metrics"].(map[string]any)["path.point"].(float64))
		}
		if len(points) == 0 {
			t.Fatal("path.point never in telemetry")
		}
		for i := 1; i < len(points); i++ {
			if points[i] < points[i-1] {
				t.Fatalf("path.point went back: %v", points)
			}
		}
		// path.points is the length of the file once it is parsed.
		if n := s.matching("autopilot/telemetry", func(m map[string]any) bool { return m["metrics"].(map[string]any)["path.points"] == 403.0 }); len(n) == 0 {
			t.Fatal("path.points never 403 in telemetry")
		}
		s.waitFor("idle again", 5*time.Second, func() bool {
			ms := s.matching("autopilot/state", nil)
			return ms[len(ms)-1]["mode"] == "idle"
		})
	})

	t.Run("switches: fix loss, link loss, fault", func(t *testing.T) {
		// Fix loss pauses a path.
		s.cmd("autopilot", "f-1", "follow", fmt.Sprintf(`"points":[[%.8f,%.8f]]`, 54.69, 25.28))
		s.waitFor("accepted", 5*time.Second, func() bool { return len(s.ackOf("autopilot", "f-1")) > 0 })
		s.ctl("fix", "rtk_float")
		s.waitFor("path_paused", 6*time.Second, func() bool {
			return len(s.matching("autopilot/event", func(m map[string]any) bool { return m["event"] == "path_paused" && m["reason"] == "fix" })) > 0
		})
		s.ctl("fix", "rtk_fixed")
		s.waitFor("path_resumed", 6*time.Second, func() bool {
			return len(s.matching("autopilot/event", func(m map[string]any) bool { return m["event"] == "path_resumed" })) > 0
		})
		// Link loss (the server goes away) pauses it, and it stays paused.
		s.serverOnline(false)
		s.waitFor("path_paused for the link", 10*time.Second, func() bool {
			return len(s.matching("autopilot/event", func(m map[string]any) bool { return m["event"] == "path_paused" && m["reason"] == "link" })) > 0
		})
		s.serverOnline(true)
		time.Sleep(2 * time.Second)
		if a := s.send("autopilot", "f-resume", "resume"); a["state"] != "done" {
			t.Fatal(a)
		}
		if a := s.send("autopilot", "f-stop", "stop"); a["state"] != "done" {
			t.Fatal(a)
		}
		if a := s.final("autopilot", "f-1", 5*time.Second); a["error"] != "cancelled" {
			t.Fatalf("follow ended with %v", a)
		}
		// A fault.
		s.ctl("fault", "motor_stall")
		s.waitFor("fault event", 3*time.Second, func() bool {
			return len(s.matching("autopilot/event", func(m map[string]any) bool { return m["event"] == "fault" && m["code"] == "motor_stall" })) > 0
		})
		if a := s.send("autopilot", "c-1", "clear_fault"); a["error"] != "motor_stall" {
			t.Fatalf("%v", a)
		}
		s.ctl("fault", "none")
		if a := s.send("autopilot", "c-2", "clear_fault"); a["state"] != "done" {
			t.Fatalf("%v", a)
		}
		// The gateway goes away: offline (retained), then online again.
		s.ctl("link", "down")
		s.waitFor("offline", 3*time.Second, func() bool { return s.lastStatus() == "offline" })
		s.ctl("link", "up")
		s.waitFor("online again", 3*time.Second, func() bool { return s.lastStatus() == "online" })
	})

	t.Run("gateway firmware update over chunk transfer", func(t *testing.T) {
		img := fwImage("0.9.1", 20000)
		s.mu.Lock()
		s.files["gw-fw/0.9.1.bin"] = img
		s.mu.Unlock()
		s.waitFor("link", 10*time.Second, func() bool { return s.lastStatus() == "online" })
		s.cmd("gateway", "ota-1", "ota", `"version":"0.9.1"`, fmt.Sprintf(`"size":%d`, len(img)))
		a := s.final("gateway", "ota-1", 40*time.Second)
		if a["state"] != "done" || a["result"].(map[string]any)["version"] != "0.9.1" {
			t.Fatalf("ota: %v", a)
		}
		ms := s.matching("gateway/state", nil)
		if ms[len(ms)-1]["firmware"] != "0.9.1" {
			t.Fatalf("state %v", ms[len(ms)-1])
		}
	})
}

func (s *serverRole) hasStatus(text string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.got {
		if m.topic == "gateway/status" && string(m.payload) == text {
			return true
		}
	}
	return false
}

func (s *serverRole) lastStatus() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	last := ""
	for _, m := range s.got {
		if m.topic == "gateway/status" {
			last = string(m.payload)
		}
	}
	return last
}
