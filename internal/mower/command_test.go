package mower

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
)

// ---- Fakes ---------------------------------------------------------------------------

type published struct {
	device  core.DeviceID
	suffix  string
	payload []byte
	fast    bool
}

type fakePub struct {
	mu  sync.Mutex
	out []published
}

func (p *fakePub) Publish(_ context.Context, d core.DeviceID, suffix string, payload []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.out = append(p.out, published{d, suffix, payload, false})
	return nil
}

func (p *fakePub) PublishFast(_ context.Context, d core.DeviceID, suffix string, payload []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.out = append(p.out, published{d, suffix, payload, true})
	return nil
}

func (p *fakePub) all() []published {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]published(nil), p.out...)
}

// waitFor waits until n messages were published on suffix (publishing runs in the background).
func (p *fakePub) waitFor(t *testing.T, suffix string, n int) []published {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		var got []published
		for _, m := range p.all() {
			if m.suffix == suffix {
				got = append(got, m)
			}
		}
		if len(got) >= n {
			return got
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d messages on %s, want %d", len(got), suffix, n)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

type fakePush struct {
	mu   sync.Mutex
	msgs []api.ServerMessage
}

func (p *fakePush) Push(m api.ServerMessage) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.msgs = append(p.msgs, m)
}

func (p *fakePush) all() []api.ServerMessage {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]api.ServerMessage(nil), p.msgs...)
}

// memLedger keeps commands in memory, with the same transitions as the database.
type memLedger struct {
	mu   sync.Mutex
	cmds map[string]api.Command
}

func (l *memLedger) insert(_ context.Context, c api.Command) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.cmds[c.ID] = c
	return nil
}

func (l *memLedger) update(_ context.Context, id string, fn func(api.Command) (api.Command, bool)) (api.Command, bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	cur, ok := l.cmds[id]
	if !ok {
		return api.Command{}, false, nil
	}
	next, changed := fn(cur)
	if changed {
		l.cmds[id] = next
	}
	return next, changed, nil
}

func (l *memLedger) openIDs(_ context.Context, device core.DeviceID, board api.Board) ([]string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var ids []string
	for id, c := range l.cmds {
		if isOpen(c) && (device == "" || (c.Device == string(device) && c.Board == board)) {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (l *memLedger) get(id string) api.Command {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.cmds[id]
}

// rig is a service over fakes, with a clock the test moves.
type rig struct {
	*Service
	pub    *fakePub
	push   *fakePush
	ledger *memLedger
	clock  time.Time
}

func newRig(t *testing.T) *rig {
	t.Helper()
	r := &rig{pub: &fakePub{}, push: &fakePush{}, ledger: &memLedger{cmds: map[string]api.Command{}}, clock: time.Unix(1794650000, 0).UTC()}
	r.Service = New(nil, r.push)
	r.Service.now = func() time.Time { return r.clock }
	r.Service.cmds.ledger = r.ledger
	r.Connect(r.pub)
	return r
}

func (r *rig) advance(d time.Duration) {
	r.clock = r.clock.Add(d)
	r.tick(context.Background(), r.clock)
}

// send makes a user command to the autopilot of "m1".
func (r *rig) send(t *testing.T, board api.Board, cmd string, params map[string]json.RawMessage) api.Command {
	t.Helper()
	c, err := r.dispatch(context.Background(), outgoing{device: "m1", board: board, cmd: cmd, params: params, persist: true})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func (r *rig) ack(t *testing.T, device core.DeviceID, board api.Board, body string) {
	t.Helper()
	if err := r.ingestAck(context.Background(), device, board, []byte(body)); err != nil {
		t.Fatal(err)
	}
}

func idOf(t *testing.T, payload []byte) string {
	t.Helper()
	var m struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(payload, &m); err != nil || m.ID == "" {
		t.Fatalf("no id in %s", payload)
	}
	return m.ID
}

// ---- Resend and acks ---------------------------------------------------------------

// No ack: the same command goes out again with the same id after 5 s, 3 times,
// and then its outcome is unknown (§5).
func TestResendWithTheSameIDThenOutcomeUnknown(t *testing.T) {
	r := newRig(t)
	c := r.send(t, api.BoardAutopilot, "stop", nil)
	if c.State != api.CommandSent || c.Attempts != 1 {
		t.Fatalf("%+v", c)
	}
	r.pub.waitFor(t, "autopilot/cmd", 1)

	r.advance(4900 * time.Millisecond)
	if n := len(r.pub.waitFor(t, "autopilot/cmd", 1)); n != 1 {
		t.Fatalf("sent again before 5 s: %d", n)
	}
	for resend := 1; resend <= 3; resend++ {
		r.advance(5 * time.Second)
		r.pub.waitFor(t, "autopilot/cmd", 1+resend)
	}
	sent := r.pub.waitFor(t, "autopilot/cmd", 4)
	for _, m := range sent {
		if m.device != "m1" || string(m.payload) != string(sent[0].payload) || idOf(t, m.payload) != c.ID {
			t.Fatalf("a resend differs from the first send: %s", m.payload)
		}
	}
	if got := r.ledger.get(c.ID); got.State != api.CommandSent || got.Attempts != 4 {
		t.Fatalf("after 3 resends: %+v", got)
	}

	// 5 s after the last resend with no ack: the outcome is unknown, and nothing is sent again.
	r.advance(5 * time.Second)
	got := r.ledger.get(c.ID)
	if got.State != api.CommandUnknown || got.Error == nil || *got.Error != errNoAck || got.FinishedAt == nil {
		t.Fatalf("after the last wait: %+v", got)
	}
	r.advance(time.Minute)
	if n := len(r.pub.all()); n != 4 {
		t.Fatalf("%d publishes, want 4", n)
	}
}

// A lost ack is recovered by the resend: the board answers the repeated id with
// its last ack, and the server stops sending.
func TestLostAckIsRecoveredByTheResend(t *testing.T) {
	r := newRig(t)
	c := r.send(t, api.BoardGateway, "ping", nil)
	r.pub.waitFor(t, "gateway/cmd", 1)
	// The first ack was lost. The resend comes after 5 s; the board answers it.
	r.advance(5 * time.Second)
	r.pub.waitFor(t, "gateway/cmd", 2)
	r.ack(t, "m1", api.BoardGateway, `{"id":"`+c.ID+`","cmd":"ping","ok":true,"state":"done","result":{"pong":"m1"},"time":1794650006.0}`)

	got := r.ledger.get(c.ID)
	if got.State != api.CommandDone || got.Attempts != 2 || string(got.Result) != `{"pong":"m1"}` {
		t.Fatalf("%+v", got)
	}
	r.advance(time.Minute)
	if n := len(r.pub.all()); n != 2 {
		t.Fatalf("%d publishes after the ack, want 2", n)
	}
}

// A long-running command: accepted stops the resends; the final ack ends it.
func TestAcceptedStopsTheResendsAndTheFinalAckEndsIt(t *testing.T) {
	r := newRig(t)
	c := r.send(t, api.BoardAutopilot, "follow", map[string]json.RawMessage{"points": json.RawMessage(`[[54.1,25.1]]`)})
	r.pub.waitFor(t, "autopilot/cmd", 1)
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+c.ID+`","cmd":"follow","ok":true,"state":"accepted","time":1794650001.1}`)
	if got := r.ledger.get(c.ID); got.State != api.CommandAccepted {
		t.Fatalf("%+v", got)
	}
	r.advance(time.Minute)
	if n := len(r.pub.all()); n != 1 {
		t.Fatalf("a command the board accepted was sent again: %d", n)
	}
	// The same accepted ack again (the board repeats its last ack) changes nothing.
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+c.ID+`","cmd":"follow","ok":true,"state":"accepted"}`)
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+c.ID+`","cmd":"follow","ok":false,"state":"failed","error":"no_fix","message":"No fixed RTK solution","result":{"fix":"single"}}`)
	got := r.ledger.get(c.ID)
	if got.State != api.CommandFailed || *got.Error != "no_fix" || *got.Message != "No fixed RTK solution" || string(got.Result) != `{"fix":"single"}` || got.FinishedAt == nil {
		t.Fatalf("%+v", got)
	}
	// A final ack is final: a stray late ack does not change it.
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+c.ID+`","cmd":"follow","ok":true,"state":"done"}`)
	if got := r.ledger.get(c.ID); got.State != api.CommandFailed {
		t.Fatalf("a final ack was overwritten: %+v", got)
	}
}

// An ack from another device or board, or for an unknown id, changes nothing.
func TestAckForSomebodyElsesCommandIsIgnored(t *testing.T) {
	r := newRig(t)
	c := r.send(t, api.BoardAutopilot, "stop", nil)
	r.ack(t, "m2", api.BoardAutopilot, `{"id":"`+c.ID+`","state":"done"}`)
	r.ack(t, "m1", api.BoardGateway, `{"id":"`+c.ID+`","state":"done"}`)
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"c-unknown","state":"done"}`)
	if got := r.ledger.get(c.ID); got.State != api.CommandSent {
		t.Fatalf("%+v", got)
	}
	if err := r.ingestAck(context.Background(), "m1", api.BoardAutopilot, []byte(`{"id":"c","state":"maybe"}`)); err == nil {
		t.Fatal("an ack with a bad state was taken")
	}
}

// An ack that arrives after the outcome was declared unknown still settles the command.
func TestLateAckSettlesAnUnknownCommand(t *testing.T) {
	r := newRig(t)
	c := r.send(t, api.BoardAutopilot, "stop", nil)
	for i := 0; i < 5; i++ {
		r.advance(5 * time.Second)
	}
	if got := r.ledger.get(c.ID); got.State != api.CommandUnknown {
		t.Fatalf("%+v", got)
	}
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+c.ID+`","state":"done"}`)
	if got := r.ledger.get(c.ID); got.State != api.CommandDone || got.Error != nil {
		t.Fatalf("%+v", got)
	}
}

// ---- A new boot --------------------------------------------------------------------

// A new boot value fails every open command of that board (§5), and only that board's.
func TestNewBootFailsTheOpenCommandsOfThatBoard(t *testing.T) {
	r := newRig(t)
	ap1 := r.send(t, api.BoardAutopilot, "stop", nil)
	ap2 := r.send(t, api.BoardAutopilot, "follow", map[string]json.RawMessage{"points": json.RawMessage(`[[54.1,25.1]]`)})
	gw := r.send(t, api.BoardGateway, "ping", nil)
	done := r.send(t, api.BoardAutopilot, "manual_start", nil)
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+ap2.ID+`","state":"accepted"}`)
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+done.ID+`","state":"done"}`)
	other := r.send(t, api.BoardAutopilot, "pause", nil)
	other2, _ := r.dispatch(context.Background(), outgoing{device: "m2", board: api.BoardAutopilot, cmd: "stop", persist: true})
	_ = other

	r.boardRestarted(context.Background(), "m1", api.BoardAutopilot)

	for _, id := range []string{ap1.ID, ap2.ID, other.ID} {
		got := r.ledger.get(id)
		if got.State != api.CommandFailed || got.Error == nil || *got.Error != errBoardRestarted || got.FinishedAt == nil {
			t.Errorf("%s: %+v", got.Cmd, got)
		}
	}
	if got := r.ledger.get(gw.ID); got.State != api.CommandSent {
		t.Errorf("the gateway's command was failed by the autopilot's boot: %+v", got)
	}
	if got := r.ledger.get(done.ID); got.State != api.CommandDone {
		t.Errorf("a finished command was changed: %+v", got)
	}
	if got := r.ledger.get(other2.ID); got.State != api.CommandSent {
		t.Errorf("another device's command was failed: %+v", got)
	}
	// The failed commands are not sent again; the gateway's, still open, is.
	r.pub.waitFor(t, "autopilot/cmd", 4)
	r.advance(5 * time.Second)
	r.pub.waitFor(t, "gateway/cmd", 2)
	time.Sleep(50 * time.Millisecond)
	if n := len(r.pub.waitFor(t, "autopilot/cmd", 4)); n != 6 { // 5 first sends + the resend of the other device's command
		t.Errorf("%d autopilot commands published; a failed command was sent again", n)
	}
	// Every change was pushed to the browsers.
	pushed := 0
	for _, m := range r.push.all() {
		if mc, ok := m.V.(api.MsgCommand); ok && mc.Command.State == api.CommandFailed {
			pushed++
		}
	}
	if pushed != 3 {
		t.Errorf("%d failed commands pushed, want 3", pushed)
	}
}

// An update ends with a restart, and the board sends the final ack for the same
// command id afterwards (§6.5): that ack still settles the command the server
// failed for the new boot.
func TestFinalAckOfAnUpdateAfterTheRestart(t *testing.T) {
	r := newRig(t)
	c := r.send(t, api.BoardGateway, "ota", map[string]json.RawMessage{"version": json.RawMessage(`"1.0.1"`)})
	r.ack(t, "m1", api.BoardGateway, `{"id":"`+c.ID+`","cmd":"ota","ok":true,"state":"accepted"}`)
	r.boardRestarted(context.Background(), "m1", api.BoardGateway)
	if got := r.ledger.get(c.ID); got.State != api.CommandFailed || *got.Error != errBoardRestarted {
		t.Fatalf("%+v", got)
	}
	r.ack(t, "m1", api.BoardGateway, `{"id":"`+c.ID+`","cmd":"ota","ok":true,"state":"done","result":{"version":"1.0.1","previous":"1.0.0","partition":"ota_1"}}`)
	got := r.ledger.get(c.ID)
	if got.State != api.CommandDone || got.Error != nil || got.Message != nil || !strings.Contains(string(got.Result), "ota_1") {
		t.Fatalf("%+v", got)
	}
}

// Commands open when the server stopped are closed with an unknown outcome when it starts.
func TestOpenCommandsAreClosedWhenTheServerStarts(t *testing.T) {
	r := newRig(t)
	open := r.send(t, api.BoardAutopilot, "follow", map[string]json.RawMessage{"points": json.RawMessage(`[[54.1,25.1]]`)})
	done := r.send(t, api.BoardAutopilot, "stop", nil)
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+done.ID+`","state":"done"}`)
	// A new server instance over the same ledger.
	r2 := newRig(t)
	r2.Service.cmds.ledger = r.ledger
	r2.recoverOpen(context.Background())
	if got := r.ledger.get(open.ID); got.State != api.CommandUnknown || *got.Error != errServerRestart {
		t.Fatalf("%+v", got)
	}
	if got := r.ledger.get(done.ID); got.State != api.CommandDone {
		t.Fatalf("%+v", got)
	}
}

// ---- What goes on the wire and what is kept -------------------------------------------

func TestWireFormat(t *testing.T) {
	r := newRig(t)
	c, err := r.dispatch(context.Background(), outgoing{
		device: "m1", board: api.BoardAutopilot, cmd: "follow",
		params:    map[string]json.RawMessage{"points": json.RawMessage(`[[54.68712345,25.27965432]]`), "reverse": json.RawMessage(`true`)},
		expiresIn: 60, persist: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	m := r.pub.waitFor(t, "autopilot/cmd", 1)[0]
	if m.fast {
		t.Fatal("a command is QoS 1")
	}
	var wire map[string]any
	if err := json.Unmarshal(m.payload, &wire); err != nil {
		t.Fatal(err)
	}
	if wire["id"] != c.ID || wire["cmd"] != "follow" || wire["reverse"] != true || wire["expires_at"] != float64(r.clock.Unix()+60) {
		t.Fatalf("%s", m.payload)
	}
	if !strings.HasPrefix(c.ID, "c-") || !core.ValidID(c.ID) {
		t.Fatalf("id %q", c.ID)
	}
}

// The password of ntrip_set goes to the gateway and nowhere else.
func TestSecretOnlyOnTheWire(t *testing.T) {
	r := newRig(t)
	c, err := r.dispatch(context.Background(), outgoing{
		device: "m1", board: api.BoardGateway, cmd: "ntrip_set",
		params:  map[string]json.RawMessage{"host": json.RawMessage(`"caster.example"`), "port": json.RawMessage(`2101`)},
		secret:  map[string]json.RawMessage{"password": json.RawMessage(`"s3cret-value"`)},
		persist: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	m := r.pub.waitFor(t, "gateway/cmd", 1)[0]
	if !strings.Contains(string(m.payload), `"password":"s3cret-value"`) {
		t.Fatalf("the gateway does not get the password: %s", m.payload)
	}
	r.advance(5 * time.Second) // a resend keeps it too
	if !strings.Contains(string(r.pub.waitFor(t, "gateway/cmd", 2)[1].payload), "s3cret-value") {
		t.Fatal("a resend lost the password")
	}
	stored, _ := json.Marshal(r.ledger.get(c.ID))
	pushed, _ := json.Marshal(r.push.all())
	for name, b := range map[string][]byte{"returned command": mustJSON(c), "stored command": stored, "pushed messages": pushed} {
		if strings.Contains(string(b), "s3cret-value") || strings.Contains(string(b), "password") {
			t.Errorf("the %s holds the password: %s", name, b)
		}
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func TestCommandsOverTheMessageLimitAreRefused(t *testing.T) {
	r := newRig(t)
	_, err := r.dispatch(context.Background(), outgoing{
		device: "m1", board: api.BoardGateway, cmd: "ota",
		params: map[string]json.RawMessage{"version": json.RawMessage(`"` + strings.Repeat("a", MaxPayloadBytes) + `"`)},
	})
	if e := apperr.From(err); e.Code != api.CodeBadRequest {
		t.Fatalf("%v", err)
	}
}

// ---- Parameters ----------------------------------------------------------------------

func TestParseCommandParams(t *testing.T) {
	raw := func(s string) *json.RawMessage { m := json.RawMessage(s); return &m }
	good := []struct {
		board  api.Board
		cmd    string
		params *json.RawMessage
	}{
		{api.BoardGateway, "ping", nil},
		{api.BoardGateway, "ping", raw(`null`)},
		{api.BoardGateway, "restart", raw(`{}`)},
		{api.BoardGateway, "ota", raw(`{"version":"0.4.1","file":"0.4.1.bin","size":812345}`)},
		{api.BoardGateway, "autopilot_reset", nil},
		{api.BoardAutopilot, "stop", nil},
		{api.BoardAutopilot, "blade", raw(`{"on":true}`)},
		{api.BoardAutopilot, "follow", raw(`{"points":[[54.68712345,25.27965432]],"reverse":true,"type":"edge"}`)},
		{api.BoardAutopilot, "follow", raw(`{"points":[[1,2]]}`)},
		{api.BoardAutopilot, "speed_limit", raw(`{"limits":{"max":1.5,"transit":0,"edge":null,"fill":0.5,"manual":2}}`)},
		{api.BoardAutopilot, "record_start", raw(`{"session":"r-17","spacing":0.1}`)},
		{api.BoardAutopilot, "path_start", raw(`{"path":"j-2031","size":4096,"sha256":"` + strings.Repeat("ab", 32) + `","from_point":413}`)},
		{api.BoardAutopilot, "restart", nil},
	}
	for _, c := range good {
		if _, err := ParseCommandParams(c.board, c.cmd, c.params); err != nil {
			t.Errorf("%s %s: %v", c.board, c.cmd, err)
		}
	}
	bad := []struct {
		board  api.Board
		cmd    string
		params *json.RawMessage
		why    string
	}{
		{api.BoardGateway, "nope", nil, "unknown command"},
		{api.BoardGateway, "follow", nil, "an autopilot command on the gateway"},
		{api.BoardGateway, "monitor_start", raw(`{}`), "monitor commands go through monitor_watch"},
		{api.BoardGateway, "ntrip_set", raw(`{}`), "ntrip_set is the server's own"},
		{api.BoardGateway, "ntrip_clear", nil, "ntrip_clear is the server's own"},
		{api.BoardGateway, "ping", raw(`{"x":1}`), "a parameter that is not defined"},
		{api.BoardGateway, "ping", raw(`[1]`), "params that are not an object"},
		{api.BoardGateway, "ota", nil, "version is required"},
		{api.BoardGateway, "ota", raw(`{"version":"a b"}`), "bad version"},
		{api.BoardGateway, "ota", raw(`{"version":"1","file":"../x.bin"}`), "a path as file"},
		{api.BoardGateway, "ota", raw(`{"version":"1","size":-1}`), "negative size"},
		{api.BoardGateway, "ota", raw(`{"version":"1","size":"9"}`), "size as a string"},
		{api.BoardAutopilot, "blade", raw(`{"on":"yes"}`), "on is a bool"},
		{api.BoardAutopilot, "follow", raw(`{"points":[]}`), "no points"},
		{api.BoardAutopilot, "follow", raw(`{"points":[[91,0]]}`), "latitude out of range"},
		{api.BoardAutopilot, "follow", raw(`{"points":[[1,2,3]]}`), "a point with three numbers"},
		{api.BoardAutopilot, "follow", raw(`{"points":` + strings.Repeat("[[1,2],", 100) + `[1,2]]}`), "101 points"},
		{api.BoardAutopilot, "follow", raw(`{"points":[[1,2]],"speed":0.5}`), "speed is gone"},
		{api.BoardAutopilot, "follow", raw(`{"points":[[1,2]],"blade":true}`), "blade is gone"},
		{api.BoardAutopilot, "follow", raw(`{"points":[[1,2]],"type":"mow"}`), "unknown type"},
		{api.BoardAutopilot, "speed_limit", nil, "limits is required"},
		{api.BoardAutopilot, "speed_limit", raw(`{"limits":{}}`), "no limit named"},
		{api.BoardAutopilot, "speed_limit", raw(`{"limits":{"top":1}}`), "unknown limit"},
		{api.BoardAutopilot, "speed_limit", raw(`{"limits":{"max":-0.1}}`), "negative limit"},
		{api.BoardAutopilot, "speed_limit", raw(`{"limits":{"max":"1"}}`), "limit as a string"},
		{api.BoardAutopilot, "speed_limit", raw(`{"limits":[1]}`), "limits as an array"},
		{api.BoardAutopilot, "path_start", raw(`{"path":"j-1","size":1,"sha256":"ABC"}`), "bad sha256"},
		{api.BoardAutopilot, "path_start", raw(`{"path":"j 1","size":1,"sha256":"` + strings.Repeat("a", 64) + `"}`), "bad path id"},
		{"toaster", "stop", nil, "unknown board"},
	}
	for _, c := range bad {
		_, err := ParseCommandParams(c.board, c.cmd, c.params)
		if e := apperr.From(err); err == nil || e.Code != api.CodeBadRequest {
			t.Errorf("%s: accepted (%v)", c.why, err)
		}
	}
	// What is checked is what goes on the wire, as given.
	got, err := ParseCommandParams(api.BoardGateway, "ota", raw(`{"version":"0.4.1","size":812345}`))
	if err != nil || string(got["version"]) != `"0.4.1"` || string(got["size"]) != `812345` || len(got) != 2 {
		t.Fatalf("%v %v", got, err)
	}
}

func TestParseAck(t *testing.T) {
	a, err := ParseAck([]byte(`{"id":"c-1","cmd":"x","ok":false,"state":"failed","error":"no_fix","message":"m","result":{"a":1},"time":1.5}`))
	if err != nil || a.ID != "c-1" || a.State != "failed" || a.Error != "no_fix" || a.Message != "m" || string(a.Result) != `{"a":1}` || !a.Final() {
		t.Fatalf("%+v %v", a, err)
	}
	if a, _ := ParseAck([]byte(`{"id":"c-1","state":"accepted"}`)); a.Final() {
		t.Fatal("accepted is not final")
	}
	for _, bad := range []string{`x`, `[]`, `{"state":"done"}`, `{"id":"a b","state":"done"}`, `{"id":"c","state":"ok"}`, `{"id":"c","state":"done","result":[1]}`} {
		if _, err := ParseAck([]byte(bad)); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}

// ---- Rules before sending -----------------------------------------------------------------

func rowWith(gatewayStatus, gatewayState, autopilotState string) deviceRow {
	r := deviceRow{name: "m1"}
	if gatewayStatus != "" {
		r.gatewayStatus = &gatewayStatus
	}
	if gatewayState != "" {
		r.gateway.state = []byte(gatewayState)
	}
	if autopilotState != "" {
		r.autopilot.state = []byte(autopilotState)
	}
	return r
}

const (
	gwUp      = `{"protocol":"0.1","boot":2,"autopilot_link":"up"}`
	apIdle    = `{"protocol":"0.1","boot":1,"mode":"idle"}`
	apPath    = `{"protocol":"0.1","boot":1,"mode":"path","path":"j-1"}`
	apManual  = `{"protocol":"0.1","boot":1,"mode":"manual"}`
	apFault   = `{"protocol":"0.1","boot":1,"mode":"fault"}`
	apUnknown = `{"protocol":"0.1","boot":1}`
)

// The gateway is restarted or updated only while the autopilot is idle (§6.4).
func TestGatewayRestartAndOtaRefusedOnlyForAKnownBusyAutopilot(t *testing.T) {
	for _, cmd := range []string{"restart", "ota"} {
		if err := checkAllowed(rowWith("online", gwUp, apIdle), api.BoardGateway, cmd); err != nil {
			t.Errorf("%s with an idle autopilot: %v", cmd, err)
		}
		for name, row := range map[string]deviceRow{
			"a path runs":             rowWith("online", gwUp, apPath),
			"manual":                  rowWith("online", gwUp, apManual),
			"fault":                   rowWith("online", gwUp, apFault),
			"a state without a mode":  rowWith("online", gwUp, apUnknown),
			"link not reported, path": rowWith("online", "", apPath),
		} {
			err := checkAllowed(row, api.BoardGateway, cmd)
			if e := apperr.From(err); err == nil || e.Code != api.CodeConflict {
				t.Errorf("%s refused? %s: %v", cmd, name, err)
			}
		}
	}
	// Allowed: the board link is down (or incompatible), whatever the stale autopilot state
	// says, and no autopilot state was ever received.
	for _, cmd := range []string{"restart", "ota"} {
		for name, row := range map[string]deviceRow{
			"link down, stale path":   rowWith("online", `{"protocol":"0.1","autopilot_link":"down"}`, apPath),
			"link incompatible":       rowWith("online", `{"protocol":"0.1","autopilot_link":"incompatible"}`, apPath),
			"link down, idle":         rowWith("online", `{"protocol":"0.1","autopilot_link":"down"}`, apIdle),
			"no autopilot state ever": rowWith("online", gwUp, ""),
			"no states at all":        rowWith("", "", ""),
			"link not reported, idle": rowWith("online", "", apIdle),
		} {
			if err := checkAllowed(row, api.BoardGateway, cmd); err != nil {
				t.Errorf("%s refused with %s: %v", cmd, name, err)
			}
		}
	}
	// A running path is named in the reason.
	if err := checkAllowed(rowWith("online", gwUp, apPath), api.BoardGateway, "restart"); err == nil || !strings.Contains(err.Error(), "path") {
		t.Errorf("reason: %v", err)
	}
	// The idle rule is for the gateway's restart and update only.
	for _, cmd := range []string{"ping", "autopilot_reset"} {
		if err := checkAllowed(rowWith("online", gwUp, apPath), api.BoardGateway, cmd); err != nil {
			t.Errorf("%s during a path: %v", cmd, err)
		}
	}
	if err := checkAllowed(rowWith("online", gwUp, apPath), api.BoardAutopilot, "restart"); err != nil {
		t.Errorf("the autopilot's own restart is the board's to refuse (wrong_mode): %v", err)
	}
}

func TestOfflineMowerAndUnsupportedProtocol(t *testing.T) {
	if err := checkAllowed(rowWith("offline", gwUp, apIdle), api.BoardAutopilot, "stop"); err == nil {
		t.Error("a command to an offline mower was sent")
	}
	if err := checkAllowed(rowWith("", "", ""), api.BoardAutopilot, "stop"); err != nil {
		t.Errorf("a device with no status yet: %v", err)
	}
	old := `{"protocol":"9.0","boot":1,"mode":"idle"}`
	if err := checkAllowed(rowWith("online", gwUp, old), api.BoardAutopilot, "stop"); err == nil {
		t.Error("a command to a board with an unsupported protocol was sent")
	}
	if err := checkAllowed(rowWith("online", gwUp, old), api.BoardAutopilot, "ota"); err != nil {
		t.Errorf("ota is the one command an unsupported board gets: %v", err)
	}
}
