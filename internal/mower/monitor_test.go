package mower

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/config"
)

func TestDriveSetpoints(t *testing.T) {
	var d driving
	d.init()
	t0 := time.Unix(1794650000, 250_000_000)
	if _, ok := d.step("m1", t0); ok {
		t.Fatal("a setpoint with no input")
	}
	d.devs["m1"] = &driveState{v: 0.5, w: -0.2, last: t0, running: true}
	a, ok := d.step("m1", t0.Add(50*time.Millisecond))
	if !ok || a.V != 0.5 || a.W != -0.2 || a.Time != 1794650000.3 {
		t.Fatalf("%+v %v", a, ok)
	}
	b, _ := d.step("m1", t0.Add(150*time.Millisecond))
	if b.Seq != a.Seq+1 {
		t.Fatalf("seq %d then %d: it grows by one per setpoint", a.Seq, b.Seq)
	}
	// Another device shares no state but the counter, which only has to grow.
	d.devs["m2"] = &driveState{last: t0, running: true}
	if c, _ := d.step("m2", t0); c.Seq != b.Seq+1 {
		t.Fatalf("seq %d", c.Seq)
	}
	// The browser went quiet: the server falls silent, and the loop ends.
	if _, ok := d.step("m1", t0.Add(driveFresh+time.Millisecond)); ok {
		t.Fatal("a stale setpoint was published")
	}
	if d.devs["m1"].running {
		t.Fatal("the loop of a quiet browser keeps running")
	}
	// The wire form of §9.
	body, _ := json.Marshal(Setpoint{Seq: 1041, Time: 1794650000.25, V: 0.5, W: -0.2})
	if string(body) != `{"seq":1041,"time":1794650000.25,"v":0.5,"w":-0.2}` {
		t.Fatalf("%s", body)
	}
}

func TestDriveRejectsBadInput(t *testing.T) {
	r := newRig(t)
	for _, req := range []api.RequestDrive{
		{Device: "status", V: 0, W: 0},
		{Device: "a b", V: 0, W: 0},
	} {
		if e := apperr.From(r.Drive(context.Background(), req)); e.Code != api.CodeNotFound {
			t.Errorf("%+v: %v", req, e)
		}
	}
	nan := 0.0
	nan /= nan
	if e := apperr.From(r.Drive(context.Background(), api.RequestDrive{Device: "m1", V: nan})); e.Code != api.CodeBadRequest {
		t.Errorf("NaN: %v", e)
	}
}

func TestParseSamples(t *testing.T) {
	s, err := ParseSamples([]byte(`{"session":"m-3","index":1200,"time":1794650012.000,"rate":100,
		"metrics":["battery.v","blade.on"],"samples":[[25.31,true],[25.30,null],[25.3,false]]}`))
	if err != nil || s.Session != "m-3" || s.Index != 1200 || s.Rate != 100 || len(s.Samples) != 3 || len(s.Metrics) != 2 {
		t.Fatalf("%+v %v", s, err)
	}
	if *s.Samples[0][1] != 1 || s.Samples[1][1] != nil || *s.Samples[2][1] != 0 || *s.Samples[0][0] != 25.31 {
		t.Fatalf("values %+v", s.Samples)
	}
	for _, bad := range []string{
		`x`, `{}`,
		`{"session":"a b","index":0,"time":1,"rate":1,"metrics":["a"],"samples":[]}`,
		`{"session":"m","index":-1,"time":1,"rate":1,"metrics":["a"],"samples":[]}`,
		`{"session":"m","index":0,"time":null,"rate":1,"metrics":["a"],"samples":[]}`,
		`{"session":"m","index":0,"time":1,"rate":0,"metrics":["a"],"samples":[]}`,
		`{"session":"m","index":0,"time":1,"rate":1,"metrics":[],"samples":[]}`,
		`{"session":"m","index":0,"time":1,"rate":1,"metrics":["a"],"samples":[[1,2]]}`,
		`{"session":"m","index":0,"time":1,"rate":1,"metrics":["a"],"samples":[["x"]]}`,
	} {
		if _, err := ParseSamples([]byte(bad)); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}

func TestMetricsOfferedByTheCatalogue(t *testing.T) {
	rev := int64(1)
	cat := api.BoardCatalogue{Revision: &rev, Parts: []api.CataloguePart{{Name: "battery", Metrics: []api.CatalogueMetric{
		{Name: "battery.v", Rates: []float64{10, 20, 50, 100}},
		{Name: "battery.pct", Rates: []float64{}},
		{Name: "usage.mqtt.up.*", Rates: []float64{1, 2}},
	}}}}
	if err := checkMetricsOffered(cat, api.BoardAutopilot, []string{"battery.v"}, 100); err != nil {
		t.Error(err)
	}
	if err := checkMetricsOffered(cat, api.BoardAutopilot, []string{"usage.mqtt.up.autopilot/telemetry"}, 2); err != nil {
		t.Errorf("a family member: %v", err)
	}
	for name, c := range map[string]struct {
		metrics []string
		rate    float64
	}{
		"unknown metric":   {[]string{"nope"}, 10},
		"rate not offered": {[]string{"battery.v"}, 5},
		"no rates":         {[]string{"battery.pct"}, 10},
		"one of two bad":   {[]string{"battery.v", "battery.pct"}, 10},
	} {
		if e := apperr.From(checkMetricsOffered(cat, api.BoardAutopilot, c.metrics, c.rate)); e == nil || e.Code != api.CodeBadRequest {
			t.Errorf("%s: %v", name, e)
		}
	}
	// No catalogue yet: the board decides.
	if err := checkMetricsOffered(api.BoardCatalogue{}, api.BoardAutopilot, []string{"anything"}, 3); err != nil {
		t.Error(err)
	}
}

// watched puts a stream into the service as Watch would, without the database.
func watched(r *rig, metrics ...string) *stream {
	key := streamKey{device: "m1", board: api.BoardAutopilot, rate: 100, metrics: strings.Join(metrics, "\n")}
	st := &stream{key: key, session: "m-1", metrics: metrics, state: api.MonitorStarting, lastWatch: r.clock, lastStart: r.clock}
	r.mon.streams[key] = st
	return st
}

func (r *rig) monitorMsgs() []api.MsgMonitor {
	var out []api.MsgMonitor
	for _, m := range r.push.all() {
		if mm, ok := m.V.(api.MsgMonitor); ok {
			out = append(out, mm)
		}
	}
	return out
}

// A stream runs only while a client watches: keep-alives go out every few
// seconds with the same session and metrics but a new command id, and when the
// watching stops the stream is stopped (§15).
func TestMonitorRunsOnlyWhileWatched(t *testing.T) {
	r := newRig(t)
	st := watched(r, "battery.a", "battery.v")

	// The watch request itself sent the first monitor_start; here the keep-alives.
	r.advance(4 * time.Second)
	if n := len(r.pub.all()); n != 0 {
		t.Fatalf("a keep-alive after 4 s: %d", n)
	}
	r.advance(time.Second) // 5 s
	first := r.pub.waitFor(t, "autopilot/cmd", 1)[0]
	var ka struct {
		ID, Cmd, Session string
		Metrics          []string
		Rate             float64
		Hold             int
	}
	if err := json.Unmarshal(first.payload, &ka); err != nil {
		t.Fatal(err)
	}
	if ka.Cmd != "monitor_start" || ka.Session != "m-1" || strings.Join(ka.Metrics, ",") != "battery.a,battery.v" || ka.Rate != 100 || ka.Hold != monitorHold || ka.ID == "" {
		t.Fatalf("%s", first.payload)
	}
	r.ack(t, "m1", api.BoardAutopilot, `{"id":"`+ka.ID+`","cmd":"monitor_start","ok":true,"state":"done","result":{"budget":400,"used":100}}`)
	if st.state != api.MonitorRunning {
		t.Fatalf("state %s after the ack", st.state)
	}
	// The client keeps watching (a new request every few seconds): the keep-alives go on.
	st.lastWatch = r.clock
	r.advance(5 * time.Second)
	second := r.pub.waitFor(t, "autopilot/cmd", 2)[1]
	if idOf(t, second.payload) == ka.ID {
		t.Fatal("a keep-alive reuses the command id: it is a new command (§15)")
	}
	// Keep-alives are not kept in the commands table.
	if len(r.ledger.cmds) != 0 {
		t.Fatalf("%d monitor commands stored", len(r.ledger.cmds))
	}

	// The client goes away: after the lease the stream is stopped, not extended.
	r.advance(10 * time.Second)
	r.advance(10 * time.Second)
	var last published
	deadline := time.Now().Add(3 * time.Second)
	for !strings.Contains(string(last.payload), "monitor_stop") {
		for _, m := range r.pub.all() {
			if strings.Contains(string(m.payload), "monitor_stop") {
				last = m
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("the stream was not stopped")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !strings.Contains(string(last.payload), `"session":"m-1"`) {
		t.Fatalf("%s", last.payload)
	}
	if len(r.mon.streams) != 0 {
		t.Fatal("the stream is still kept")
	}
	if msgs := r.monitorMsgs(); len(msgs) == 0 || msgs[len(msgs)-1].Stream.State != api.MonitorStopped {
		t.Fatalf("clients were not told: %+v", msgs)
	}
	// Nothing more is started for it (resends of the unanswered messages aside).
	time.Sleep(50 * time.Millisecond)
	before := len(r.pub.all())
	r.advance(time.Minute)
	time.Sleep(50 * time.Millisecond)
	for _, m := range r.pub.all()[before:] {
		if strings.Contains(string(m.payload), `"hold"`) && !resent(r.pub.all()[:before], m) {
			t.Fatalf("a stopped stream is started again: %s", m.payload)
		}
	}
}

// resent reports whether m repeats a message sent before (same bytes, so the same id).
func resent(before []published, m published) bool {
	for _, b := range before {
		if string(b.payload) == string(m.payload) {
			return true
		}
	}
	return false
}

// The budget comes from the acks, on success and on failure (§15).
func TestMonitorBudgetFromTheAcks(t *testing.T) {
	r := newRig(t)
	st := watched(r, "battery.v")
	r.monitorStartAck(st, Ack{State: "done", Result: json.RawMessage(`{"budget":400,"used":100}`)})
	got := r.monitorMsgs()
	if len(got) != 1 || got[0].Stream.State != api.MonitorRunning || got[0].Stream.Budget == nil || *got[0].Stream.Budget != 400 || *got[0].Stream.Used != 100 {
		t.Fatalf("%+v", got)
	}
	streams, err := r.Streams("m1")
	if err != nil || len(streams.Streams) != 1 || *streams.Streams[0].Used != 100 {
		t.Fatalf("%+v %v", streams, err)
	}

	// Another stream does not fit: the failure reports the budget too, and the stream is gone.
	over := watched(r, "battery.a")
	over.session = "m-2"
	r.monitorStartAck(over, Ack{State: "failed", Error: "over_budget", Message: "too much", Result: json.RawMessage(`{"budget":400,"used":390}`)})
	got = r.monitorMsgs()
	last := got[len(got)-1]
	if last.Stream.State != api.MonitorFailed || last.Error == nil || *last.Error != "over_budget" || *last.Stream.Used != 390 {
		t.Fatalf("%+v", last)
	}
	if _, kept := r.mon.streams[over.key]; kept {
		t.Fatal("a refused stream is still kept alive")
	}
	if _, kept := r.mon.streams[st.key]; !kept {
		t.Fatal("the running stream was dropped")
	}
}

// A monitor_start nobody acknowledges fails the stream with no_ack.
func TestMonitorStartWithoutAckFailsTheStream(t *testing.T) {
	r := newRig(t)
	st := watched(r, "battery.v")
	if err := r.sendMonitorStart(context.Background(), st); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		st.lastWatch = r.clock
		r.advance(5 * time.Second)
	}
	msgs := r.monitorMsgs()
	if len(msgs) == 0 || msgs[len(msgs)-1].Stream.State != api.MonitorFailed || *msgs[len(msgs)-1].Error != errNoAck {
		t.Fatalf("%+v", msgs)
	}
}

// Samples are relayed to the WebSocket while someone watches, and dropped after.
func TestSamplesAreRelayedOnlyForWatchedStreams(t *testing.T) {
	r := newRig(t)
	st := watched(r, "battery.a", "battery.v")
	body := []byte(`{"session":"m-1","index":1200,"time":1794650012.000,"rate":100,
		"metrics":["battery.a","battery.v"],"samples":[[4.1,25.31],[4.12,25.30]]}`)
	if err := r.ingestSamples("m1", api.BoardAutopilot, body); err != nil {
		t.Fatal(err)
	}
	var got []api.MsgMonitorSamples
	for _, m := range r.push.all() {
		if s, ok := m.V.(api.MsgMonitorSamples); ok {
			got = append(got, s)
		}
	}
	if len(got) != 1 || got[0].Index != 1200 || got[0].Session != "m-1" || got[0].Device != "m1" || got[0].Board != api.BoardAutopilot ||
		len(got[0].Samples) != 2 || *got[0].Samples[1][1] != 25.30 || got[0].Time.Unix() != 1794650012 {
		t.Fatalf("%+v", got)
	}
	// Another device's or board's session, or an unknown one: dropped.
	for _, c := range []struct {
		device string
		board  api.Board
	}{{"m2", api.BoardAutopilot}, {"m1", api.BoardGateway}} {
		if err := r.ingestSamples("m1", api.BoardGateway, body); err != nil {
			t.Fatal(err)
		}
		_ = c
	}
	delete(r.mon.streams, st.key)
	if err := r.ingestSamples("m1", api.BoardAutopilot, body); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, m := range r.push.all() {
		if _, ok := m.V.(api.MsgMonitorSamples); ok {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("%d relayed, want 1", count)
	}
	if err := r.ingestSamples("m1", api.BoardAutopilot, []byte(`nope`)); err == nil {
		t.Fatal("garbage taken")
	}
}

// ---- NTRIP ----------------------------------------------------------------------------

func TestNTRIPFingerprintAndSettings(t *testing.T) {
	cfg := config.NTRIP{Host: "caster.example", Port: 2101, Mountpoint: "MOUNT", User: "me", Password: "pw-one"}
	mk := func(c config.NTRIP, key string) string {
		n := &ntripSync{cfg: c, key: []byte(key)}
		return n.fingerprint()
	}
	base := mk(cfg, "k")
	if base != mk(cfg, "k") {
		t.Fatal("the fingerprint is not stable")
	}
	for name, change := range map[string]func(*config.NTRIP){
		"host":       func(c *config.NTRIP) { c.Host = "other.example" },
		"port":       func(c *config.NTRIP) { c.Port = 2102 },
		"mountpoint": func(c *config.NTRIP) { c.Mountpoint = "OTHER" },
		"user":       func(c *config.NTRIP) { c.User = "you" },
		"password":   func(c *config.NTRIP) { c.Password = "pw-two" },
	} {
		c := cfg
		change(&c)
		if mk(c, "k") == base {
			t.Errorf("a changed %s does not change the fingerprint", name)
		}
	}
	if mk(cfg, "other key") == base {
		t.Error("the fingerprint does not depend on the key")
	}
	if strings.Contains(base, "pw-one") {
		t.Error("the fingerprint holds the password")
	}
	// Fields that run together do not collide.
	if mk(config.NTRIP{Host: "ab", User: "c"}, "k") == mk(config.NTRIP{Host: "a", User: "bc"}, "k") {
		t.Error("two different settings have one fingerprint")
	}

	s := New(nil, nil)
	s.SetNTRIP(cfg, "k")
	got := s.NTRIP()
	if !got.Configured || got.Host != "caster.example" || got.Port != 2101 || got.Mountpoint != "MOUNT" || got.User != "me" || !got.PasswordSet {
		t.Fatalf("%+v", got)
	}
	if b, _ := json.Marshal(got); strings.Contains(string(b), "pw-one") {
		t.Fatalf("the API shows the password: %s", b)
	}
	if New(nil, nil).NTRIP().Configured {
		t.Fatal("no settings, yet configured")
	}
}
