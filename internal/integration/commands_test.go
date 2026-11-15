//go:build integration

// Commands, live driving, monitor streams and the caster settings: a simulated
// gateway answers what the server publishes, as wiki Mower-Protocol §5, §9, §13
// and §15 define it.

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
)

// await is the result for requestID; pushed messages that come first are skipped.
func (w *ws) await(requestID string) api.RpcResult {
	w.t.Helper()
	for {
		if m, ok := w.next().V.(api.MsgResponse); ok && m.Response.RequestID == requestID {
			return m.Response.Result
		}
	}
}

// nextOnFor is nextOn with its own wait; ok is false when nothing came in time.
func (d *mqttDevice) nextOnFor(topic string, within time.Duration) ([]byte, bool) {
	d.t.Helper()
	for i, m := range d.buffered {
		if m.topic == topic {
			d.buffered = append(d.buffered[:i], d.buffered[i+1:]...)
			return m.payload, true
		}
	}
	deadline := time.After(within)
	for {
		select {
		case m := <-d.received:
			if m.topic == topic {
				return m.payload, true
			}
			d.buffered = append(d.buffered, m)
		case <-deadline:
			return nil, false
		}
	}
}

// cmdMsg is a command as the board receives it.
type cmdMsg struct {
	ID         string          `json:"id"`
	Cmd        string          `json:"cmd"`
	ExpiresAt  *int64          `json:"expires_at"`
	Password   string          `json:"password"`
	Session    string          `json:"session"`
	Metrics    []string        `json:"metrics"`
	Rate       float64         `json:"rate"`
	Hold       int             `json:"hold"`
	Host       string          `json:"host"`
	Port       int             `json:"port"`
	Mountpoint string          `json:"mountpoint"`
	Version    string          `json:"version"`
	Raw        json.RawMessage `json:"-"`
}

// nextCmd is the next command on a board's cmd topic.
func (s *sim) nextCmd(board string, within time.Duration) (cmdMsg, bool) {
	s.t.Helper()
	b, ok := s.dev.nextOnFor(s.dev.topic(board+"/cmd"), within)
	if !ok {
		return cmdMsg{}, false
	}
	var c cmdMsg
	if err := json.Unmarshal(b, &c); err != nil {
		s.t.Fatalf("%v in %s", err, b)
	}
	c.Raw = b
	return c, true
}

func (s *sim) mustCmd(board, cmd string) cmdMsg {
	s.t.Helper()
	c, ok := s.nextCmd(board, wait)
	if !ok {
		s.t.Fatalf("no %s command on %s in time", cmd, board)
	}
	if c.Cmd != cmd {
		s.t.Fatalf("got a %s command, want %s", c.Cmd, cmd)
	}
	return c
}

func (s *sim) ack(board, id, cmd, state, extra string) {
	body := fmt.Sprintf(`{"id":%q,"cmd":%q,"ok":%t,"state":%q%s,"time":1794650001.1}`, id, cmd, state != "failed", state, extra)
	s.pub(board+"/cmd/ack", body)
}

// online brings the simulated mower up: the gateway is online and sees its
// autopilot, which is in mode.
func (s *sim) online(mode string) {
	s.pub("gateway/status", "online")
	s.pub("gateway/state", `{"protocol":"0.1","boot":10,"firmware":"0.4.0","previous":null,"partition":"ota_0","autopilot_link":"up","ntrip":"off","operator":null,"time":1794650000}`)
	s.pub("autopilot/state", fmt.Sprintf(`{"protocol":"0.1","boot":5,"firmware":"0.1.0","previous":null,"partition":"ota_0","mode":%q,"paused":null,"job":null,"recording":null,"fault":null,"time":1794650000.0}`, mode))
	s.app.waitDevice(s.name(), "the mower's state", func(d api.DeviceDetail) bool { return hasState(d.Gateway.State) && hasState(d.Autopilot.State) })
}

func (s *sim) listenForCommands() {
	s.dev.subscribe(s.dev.topic("gateway/cmd"), s.dev.topic("autopilot/cmd"), s.dev.topic("autopilot/drive"))
}

// sendCommand posts a command and returns the status and the command (when 202).
func (a *testApp) sendCommand(name string, req map[string]any) (int, api.Command, []byte) {
	a.t.Helper()
	status, _, body := a.req(a.http, "POST", "/api/devices/"+name+"/commands", req)
	var c api.Command
	if status == 202 {
		c = decode[api.Command](a.t, body)
	}
	return status, c, body
}

func (a *testApp) command(name, id string) api.Command {
	a.t.Helper()
	status, _, body := a.req(a.http, "GET", "/api/devices/"+name+"/commands/"+id, nil)
	eq(a.t, status, 200)
	return decode[api.Command](a.t, body)
}

func (a *testApp) waitCommand(name, id, what string, cond func(api.Command) bool) api.Command {
	a.t.Helper()
	var c api.Command
	eventually(a.t, what, func() bool { c = a.command(name, id); return cond(c) })
	return c
}

// A command is acknowledged; the answer reaches the browser as pushed messages.
func TestCommandIsAcknowledged(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()
	socket := app.ws()
	m.listenForCommands()
	m.online("idle")

	if s := app.status(client("", origin), "POST", "/api/devices/"+name+"/commands", map[string]any{"board": "gateway", "cmd": "ping"}); s != 401 {
		t.Fatalf("a command without a session: %d", s)
	}
	for _, c := range []struct {
		why  string
		req  map[string]any
		want int
	}{
		{"no such device", map[string]any{"board": "gateway", "cmd": "ping"}, 404},
		{"unknown command", map[string]any{"board": "gateway", "cmd": "dance"}, 400},
		{"a parameter that is missing", map[string]any{"board": "autopilot", "cmd": "blade", "params": map[string]any{}}, 400},
		{"monitor commands have their own route", map[string]any{"board": "gateway", "cmd": "monitor_start", "params": map[string]any{}}, 400},
		{"ntrip_set is the server's own", map[string]any{"board": "gateway", "cmd": "ntrip_set", "params": map[string]any{}}, 400},
	} {
		target := name
		if c.why == "no such device" {
			target = "nobody"
		}
		if s, _, body := app.sendCommand(target, c.req); s != c.want {
			t.Errorf("%s: %d %s", c.why, s, body)
		}
	}
	if m.dev.nextOnNothing(m.dev.topic("gateway/cmd"), 300*time.Millisecond) {
		t.Fatal("a refused command was published")
	}

	status, sent, body := app.sendCommand(name, map[string]any{"board": "gateway", "cmd": "ping"})
	eq(t, status, 202)
	eq(t, sent.State, api.CommandSent)
	eq(t, sent.Cmd, "ping")
	eq(t, sent.Attempts, 1)
	if sent.RequestedBy == nil || *sent.RequestedBy != user {
		t.Fatalf("requested by: %s", body)
	}

	got := m.mustCmd("gateway", "ping")
	eq(t, got.ID, sent.ID)
	m.ack("gateway", got.ID, "ping", "done", `,"result":{"pong":"`+name+`"}`)

	done := app.waitCommand(name, sent.ID, "the ack", func(c api.Command) bool { return c.State == api.CommandDone })
	eq(t, string(done.Result), `{"pong":"`+name+`"}`)
	if done.FinishedAt == nil || done.Error != nil {
		t.Fatalf("%+v", done)
	}
	t.Logf("command %s: sent as %s, acknowledged: state %s, result %s", sent.ID, sent.State, done.State, done.Result)

	// The browser was told: first the new command, then the done one.
	var states []api.CommandState
	for len(states) < 2 {
		if mc, ok := socket.next().V.(api.MsgCommand); ok && mc.Command.ID == sent.ID {
			states = append(states, mc.Command.State)
		}
	}
	eq(t, states[0], api.CommandSent)
	eq(t, states[1], api.CommandDone)

	// A long-running command: accepted, then a failure with the board's error.
	_, follow, _ := app.sendCommand(name, map[string]any{"board": "autopilot", "cmd": "follow",
		"params": map[string]any{"points": [][]float64{{54.68712345, 25.27965432}}, "speed": 0.5}, "expires_in": 60})
	fc := m.mustCmd("autopilot", "follow")
	if fc.ExpiresAt == nil || *fc.ExpiresAt < time.Now().Unix() {
		t.Fatalf("expires_at: %s", fc.Raw)
	}
	m.ack("autopilot", fc.ID, "follow", "accepted", "")
	app.waitCommand(name, follow.ID, "accepted", func(c api.Command) bool { return c.State == api.CommandAccepted })
	m.ack("autopilot", fc.ID, "follow", "failed", `,"error":"no_fix","message":"No fixed RTK solution"`)
	failed := app.waitCommand(name, follow.ID, "failed", func(c api.Command) bool { return c.State == api.CommandFailed })
	if failed.Error == nil || *failed.Error != "no_fix" {
		t.Fatalf("%+v", failed)
	}

	// The list shows both, newest first.
	status, _, body = app.req(app.http, "GET", "/api/devices/"+name+"/commands", nil)
	eq(t, status, 200)
	list := decode[api.CommandList](t, body)
	eq(t, len(list.Commands), 2)
	eq(t, list.Commands[0].ID, follow.ID)
}

func (d *mqttDevice) nextOnNothing(topic string, within time.Duration) bool {
	d.t.Helper()
	_, ok := d.nextOnFor(topic, within)
	return ok
}

// A lost ack is recovered by the resend with the same id (§5).
func TestLostAckIsRecoveredByTheResend(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()
	m.listenForCommands()
	m.online("idle")

	_, sent, _ := app.sendCommand(name, map[string]any{"board": "gateway", "cmd": "ping"})
	first := m.mustCmd("gateway", "ping")
	started := time.Now()
	t.Logf("first delivery of %s; the board does not answer", first.ID)

	// No ack: the same command comes again after 5 s.
	again, ok := m.nextCmd("gateway", 8*time.Second)
	if !ok {
		t.Fatal("no resend")
	}
	elapsed := time.Since(started)
	eq(t, again.ID, first.ID)
	eq(t, string(again.Raw), string(first.Raw))
	if elapsed < 4*time.Second || elapsed > 7*time.Second {
		t.Fatalf("resend after %s, want about 5 s", elapsed)
	}
	t.Logf("resend of %s with the same id after %s", again.ID, elapsed.Round(100*time.Millisecond))

	m.ack("gateway", again.ID, "ping", "done", `,"result":{"pong":"x"}`)
	done := app.waitCommand(name, sent.ID, "the ack of the resend", func(c api.Command) bool { return c.State == api.CommandDone })
	eq(t, done.Attempts, 2)
	t.Logf("recovered: state %s after %d sends", done.State, done.Attempts)
	if m.dev.nextOnNothing(m.dev.topic("gateway/cmd"), 6*time.Second) {
		t.Fatal("the command was sent again after the ack")
	}
}

// A new boot value fails every open command of that board (§5).
func TestNewBootFailsOpenCommands(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()
	m.listenForCommands()
	m.online("idle")

	_, follow, _ := app.sendCommand(name, map[string]any{"board": "autopilot", "cmd": "follow", "params": map[string]any{"points": [][]float64{{54.1, 25.1}}}})
	fc := m.mustCmd("autopilot", "follow")
	m.ack("autopilot", fc.ID, "follow", "accepted", "")
	app.waitCommand(name, follow.ID, "accepted", func(c api.Command) bool { return c.State == api.CommandAccepted })
	_, ping, _ := app.sendCommand(name, map[string]any{"board": "gateway", "cmd": "ping"})
	m.mustCmd("gateway", "ping")

	// The autopilot starts again: its boot counter grows.
	m.pub("autopilot/telemetry", `{"time":1794650100,"boot":6,"metrics":{"battery.v":25.1}}`)
	failed := app.waitCommand(name, follow.ID, "failed by the new boot", func(c api.Command) bool { return c.State == api.CommandFailed })
	if failed.Error == nil || *failed.Error != "board_restarted" {
		t.Fatalf("%+v", failed)
	}
	if c := app.command(name, ping.ID); c.State != api.CommandSent {
		t.Fatalf("the gateway's command: %+v", c)
	}
	t.Logf("command %s: state %s, error %s", follow.ID, failed.State, *failed.Error)
}

// The gateway is restarted or updated only while the autopilot is idle (§6.4).
func TestGatewayRestartRefusedUnlessTheAutopilotIsIdle(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()
	m.listenForCommands()
	m.online("job")

	for _, req := range []map[string]any{
		{"board": "gateway", "cmd": "restart"},
		{"board": "gateway", "cmd": "ota", "params": map[string]any{"version": "0.5.0"}},
	} {
		status, _, body := app.sendCommand(name, req)
		eq(t, status, 409)
		e := decode[api.ApiError](t, body)
		eq(t, e.Code, api.CodeConflict)
		t.Logf("%s while the autopilot runs a job: %d %s", req["cmd"], status, e.Message)
		if !strings.Contains(e.Message, "job") {
			t.Fatalf("the reason does not name the mode: %s", e.Message)
		}
	}
	if m.dev.nextOnNothing(m.dev.topic("gateway/cmd"), 300*time.Millisecond) {
		t.Fatal("a refused restart was published")
	}
	// Other commands still go.
	status, _, _ := app.sendCommand(name, map[string]any{"board": "gateway", "cmd": "ping"})
	eq(t, status, 202)
	m.mustCmd("gateway", "ping")

	// The job ends; the autopilot is idle: the restart goes out.
	m.pub("autopilot/state", `{"protocol":"0.1","boot":5,"mode":"idle","job":null,"time":1794650200.0}`)
	app.waitDevice(name, "idle", func(d api.DeviceDetail) bool { return strings.Contains(string(d.Autopilot.State), `"idle"`) })
	status, sent, _ := app.sendCommand(name, map[string]any{"board": "gateway", "cmd": "restart"})
	eq(t, status, 202)
	eq(t, m.mustCmd("gateway", "restart").ID, sent.ID)
	t.Logf("restart with an idle autopilot: %d, sent as %s", status, sent.ID)

	// The autopilot is busy again, but the gateway reports the board link down:
	// the stale job state does not count, and ota goes out.
	m.pub("autopilot/state", `{"protocol":"0.1","boot":5,"mode":"job","job":"j-2","time":1794650300.0}`)
	app.waitDevice(name, "job again", func(d api.DeviceDetail) bool { return strings.Contains(string(d.Autopilot.State), `"j-2"`) })
	status, _, _ = app.sendCommand(name, map[string]any{"board": "gateway", "cmd": "ota", "params": map[string]any{"version": "0.5.0"}})
	eq(t, status, 409)
	m.pub("gateway/state", `{"protocol":"0.1","boot":10,"autopilot_link":"down","time":1794650310}`)
	app.waitDevice(name, "link down", func(d api.DeviceDetail) bool { return strings.Contains(string(d.Gateway.State), `"down"`) })
	status, sent, _ = app.sendCommand(name, map[string]any{"board": "gateway", "cmd": "ota", "params": map[string]any{"version": "0.5.0"}})
	eq(t, status, 202)
	eq(t, m.mustCmd("gateway", "ota").ID, sent.ID)
	t.Logf("ota with the board link down and a stale job state: %d", status)
}

// Live driving: the browser's setpoint goes to autopilot/drive about 10 times
// per second, with a counter that grows, for as long as the browser sends (§9).
func TestLiveDrivingStreamsSetpoints(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()
	m.listenForCommands()
	m.online("manual")
	socket := app.ws()
	drive := m.dev.topic("autopilot/drive")

	type setpoint struct {
		Seq  int64   `json:"seq"`
		Time float64 `json:"time"`
		V    float64 `json:"v"`
		W    float64 `json:"w"`
	}
	// The browser sends its setpoint every 150 ms for a second.
	stop := time.Now().Add(1200 * time.Millisecond)
	for i := 0; time.Now().Before(stop); i++ {
		socket.send(fmt.Sprintf("d%d", i), api.RequestDrive{Device: name, V: 0.5, W: -0.2})
		time.Sleep(150 * time.Millisecond)
	}
	var got []setpoint
	for {
		b, ok := m.dev.nextOnFor(drive, 700*time.Millisecond)
		if !ok {
			break
		}
		sp := decode[setpoint](t, b)
		got = append(got, sp)
	}
	if len(got) < 8 || len(got) > 16 {
		t.Fatalf("%d setpoints in 1.2 s, want about 10 per second", len(got))
	}
	for i, sp := range got {
		if sp.V != 0.5 || sp.W != -0.2 || sp.Time < float64(time.Now().Add(-5*time.Second).Unix()) {
			t.Fatalf("%+v", sp)
		}
		if i > 0 && sp.Seq != got[i-1].Seq+1 {
			t.Fatalf("seq %d after %d: it grows by one per setpoint", sp.Seq, got[i-1].Seq)
		}
	}
	t.Logf("%d setpoints in 1.2 s, seq %d to %d, last %+v", len(got), got[0].Seq, got[len(got)-1].Seq, got[len(got)-1])

	// The browser stopped: the stream has stopped too (the autopilot stops the motors on its own).
	if m.dev.nextOnNothing(drive, 600*time.Millisecond) {
		t.Fatal("setpoints keep coming after the browser stopped sending")
	}
	// A setpoint is not answered, unless it fails.
	socket.send("bad", api.RequestDrive{Device: "status", V: 1, W: 0})
	if !isError(socket.await("bad")) {
		t.Fatal("a setpoint for an unknown device was accepted")
	}
}

// A monitor stream runs only while a client watches (§15).
func TestMonitorRunsWhileWatched(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()
	m.listenForCommands()
	m.dev.subscribe(m.dev.topic("autopilot/cmd"))
	m.online("idle")
	socket := app.ws()

	// The autopilot's catalogue offers battery.v at 100 samples per second.
	m.pub("autopilot/metrics/index", indexJSON(1, "battery"))
	m.pub("autopilot/metrics/battery", strings.Replace(partJSON(1, "Battery", metricJSON("battery.v", "", "number", "gauge", "V")), `"rates": []`, `"rates": [10, 100]`, 1))
	app.waitDevice(name, "the catalogue", func(d api.DeviceDetail) bool { return catalogueOf(d, api.BoardAutopilot).Revision != nil })

	// Asks the catalogue does not offer are refused before anything is sent.
	socket.send("w0", api.RequestMonitorWatch{Device: name, Board: api.BoardAutopilot, Metrics: []string{"battery.v"}, Rate: 7})
	if !isError(socket.await("w0")) {
		t.Fatal("a rate the metric does not offer was accepted")
	}
	socket.send("w1", api.RequestMonitorWatch{Device: name, Board: api.BoardAutopilot, Metrics: []string{"nope"}, Rate: 10})
	if !isError(socket.await("w1")) {
		t.Fatal("an unknown metric was accepted")
	}
	if m.dev.nextOnNothing(m.dev.topic("autopilot/cmd"), 200*time.Millisecond) {
		t.Fatal("a refused watch was sent to the board")
	}

	socket.send("w2", api.RequestMonitorWatch{Device: name, Board: api.BoardAutopilot, Metrics: []string{"battery.v"}, Rate: 100})
	ok, isOk := socket.await("w2").V.(api.RpcOk)
	if !isOk {
		t.Fatal("watch refused")
	}
	watching := ok.Data.V.(api.MonitorWatching)
	eq(t, watching.State, api.MonitorStarting)
	start := m.mustCmd("autopilot", "monitor_start")
	eq(t, start.Session, watching.Session)
	eq(t, start.Rate, 100.0)
	eq(t, start.Hold, 15)
	eq(t, strings.Join(start.Metrics, ","), "battery.v")
	m.ack("autopilot", start.ID, "monitor_start", "done", `,"result":{"budget":400,"used":100}`)

	// The browser is told: running, with the budget from the ack.
	var running api.MsgMonitor
	for running.Stream.State != api.MonitorRunning {
		if mm, ok := socket.next().V.(api.MsgMonitor); ok {
			running = mm
		}
	}
	if running.Stream.Budget == nil || *running.Stream.Budget != 400 || *running.Stream.Used != 100 || running.Stream.Session != watching.Session {
		t.Fatalf("%+v", running)
	}

	// Samples reach the WebSocket.
	m.pub("autopilot/monitor", fmt.Sprintf(`{"session":%q,"index":0,"time":1794650012.000,"rate":100,"metrics":["battery.v"],"samples":[[25.31],[25.30],[25.30]]}`, watching.Session))
	var samples api.MsgMonitorSamples
	for samples.Session == "" {
		if ms, ok := socket.next().V.(api.MsgMonitorSamples); ok {
			samples = ms
		}
	}
	eq(t, len(samples.Samples), 3)
	eq(t, *samples.Samples[0][0], 25.31)
	eq(t, samples.Device, name)

	// While the client watches, the server extends the stream: the same session, a new id.
	socket.send("w3", api.RequestMonitorWatch{Device: name, Board: api.BoardAutopilot, Metrics: []string{"battery.v"}, Rate: 100})
	again := socket.await("w3").V.(api.RpcOk).Data.V.(api.MonitorWatching)
	eq(t, again.Session, watching.Session) // the same metrics and rate share one stream
	keep, ok2 := m.nextCmd("autopilot", 8*time.Second)
	if !ok2 {
		t.Fatal("no keep-alive")
	}
	eq(t, keep.Cmd, "monitor_start")
	eq(t, keep.Session, watching.Session)
	if keep.ID == start.ID {
		t.Fatal("the keep-alive has the id of the first start")
	}
	m.ack("autopilot", keep.ID, "monitor_start", "done", `,"result":{"budget":400,"used":100}`)
	t.Logf("keep-alive %s for session %s, after the start %s", keep.ID, keep.Session, start.ID)

	// The client stops watching: the stream is stopped.
	socket.send("u1", api.RequestMonitorUnwatch{Device: name, Session: watching.Session})
	for {
		m2, ok := socket.next().V.(api.MsgResponse)
		if ok && m2.Response.RequestID == "u1" {
			break
		}
	}
	stop := m.mustCmd("autopilot", "monitor_stop")
	eq(t, stop.Session, watching.Session)
	m.ack("autopilot", stop.ID, "monitor_stop", "done", "")
	if _, extended := m.nextCmd("autopilot", 6*time.Second); extended {
		t.Fatal("the stream is still extended after the client stopped watching")
	}
	// Samples of a stream nobody watches are dropped.
	m.pub("autopilot/monitor", fmt.Sprintf(`{"session":%q,"index":3,"time":1794650013.000,"rate":100,"metrics":["battery.v"],"samples":[[25.3]]}`, watching.Session))
	socket.send("ping", api.RequestPing{})
	for {
		msg := socket.next()
		if _, bad := msg.V.(api.MsgMonitorSamples); bad {
			t.Fatal("samples of a stopped stream were relayed")
		}
		if r, ok := msg.V.(api.MsgResponse); ok && r.Response.RequestID == "ping" {
			break
		}
	}
	status, _, body := app.req(app.http, "GET", "/api/devices/"+name+"/monitor", nil)
	eq(t, status, 200)
	eq(t, len(decode[api.MonitorStreams](t, body).Streams), 0)
}

// The caster settings are sent to a gateway once, and again when they change;
// the password reaches the gateway and nothing else (§13).
func TestNTRIPSettingsAreSentOnceAndOnChange(t *testing.T) {
	const secret = "caster-secret-for-the-test"
	var logs bytes.Buffer
	var mu sync.Mutex
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&lockedWriter{&mu, &logs}, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	pool := newDatabase(t)
	env := map[string]string{"NTRIP_HOST": "caster.example", "NTRIP_PORT": "2101", "NTRIP_MOUNTPOINT": "MOUNT", "NTRIP_USER": "rover", "NTRIP_PASSWORD": secret}
	app := startAppOptions(t, pool, appOptions{env: env})
	m := app.sim()
	name := m.name()
	m.listenForCommands()

	// The API shows the settings without the password.
	status, _, body := app.req(app.http, "GET", "/api/ntrip", nil)
	eq(t, status, 200)
	if strings.Contains(string(body), secret) {
		t.Fatalf("the API returns the password: %s", body)
	}
	settings := decode[api.NtripSettings](t, body)
	if !settings.Configured || settings.Host != "caster.example" || settings.Port != 2101 || settings.Mountpoint != "MOUNT" || settings.User != "rover" || !settings.PasswordSet {
		t.Fatalf("%+v", settings)
	}

	// The gateway's state arrives (its link came up): the settings go out.
	m.online("idle")
	set := m.mustCmd("gateway", "ntrip_set")
	eq(t, set.Host, "caster.example")
	eq(t, set.Port, 2101)
	eq(t, set.Mountpoint, "MOUNT")
	eq(t, set.Password, secret)
	m.ack("gateway", set.ID, "ntrip_set", "done", "")
	cmd := app.waitCommand(name, set.ID, "the ack", func(c api.Command) bool { return c.State == api.CommandDone })
	t.Logf("ntrip_set %s acknowledged; params stored: %s", cmd.ID, cmd.Params)

	// The gateway publishes its state again (a field changed): nothing new is sent.
	m.pub("gateway/state", `{"protocol":"0.1","boot":10,"autopilot_link":"up","ntrip":"streaming","time":1794650300}`)
	m.pub("gateway/state", `{"protocol":"0.1","boot":10,"autopilot_link":"up","ntrip":"streaming","operator":"24601","time":1794650301}`)
	if _, again := m.nextCmd("gateway", 1500*time.Millisecond); again {
		t.Fatal("the settings were sent again although they did not change")
	}

	// The password is in no stored command, no API answer and no log line.
	var stored string
	if err := pool.QueryRow(context.Background(), `SELECT string_agg(params::text || coalesce(message, '') || coalesce(result::text, ''), ' ') FROM commands`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var fingerprints string
	if err := pool.QueryRow(context.Background(), `SELECT string_agg(fingerprint, ' ') FROM ntrip_sent`).Scan(&fingerprints); err != nil {
		t.Fatal(err)
	}
	if fingerprints == "" {
		t.Fatal("no fingerprint stored after the ack")
	}
	_, _, list := app.req(app.http, "GET", "/api/devices/"+name+"/commands", nil)
	mu.Lock()
	logged := logs.String()
	mu.Unlock()
	for what, text := range map[string]string{"commands table": stored, "fingerprint": fingerprints, "commands API": string(list), "server log": logged} {
		if strings.Contains(text, secret) {
			t.Errorf("the password is in the %s", what)
		}
	}

	// A changed password is sent again, to the same gateway, on its next state.
	env["NTRIP_PASSWORD"] = secret + "-changed"
	app2 := startAppOptions(t, pool, appOptions{env: env, sameDatabase: true})
	m2 := app2.mqttConnect()
	m2.id = m.dev.id // the same gateway, now talking to the second server
	m2.subscribe(m2.topic("gateway/cmd"))
	s2 := &sim{t: t, app: app2, dev: m2}
	s2.pub("gateway/state", `{"protocol":"0.1","boot":10,"autopilot_link":"up","ntrip":"streaming","time":1794650400}`)
	changed := s2.mustCmd("gateway", "ntrip_set")
	eq(t, changed.Password, secret+"-changed")
	t.Logf("changed password: a new ntrip_set %s after the settings changed", changed.ID)
}

type lockedWriter struct {
	mu *sync.Mutex
	w  *bytes.Buffer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}
