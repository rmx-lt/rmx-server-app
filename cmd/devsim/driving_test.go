package main

import (
	"math"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCommandIDMemory(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "c-1", "manual_start")
	first := r.ack("autopilot", "c-1")
	if first["state"] != "done" {
		t.Fatal(first)
	}
	raw := r.msgs("autopilot/cmd/ack")
	firstBytes := raw[len(raw)-1].payload

	// A repeat within 2 minutes does not run the command again: the same ack,
	// byte for byte, comes back (a second manual_start would be wrong_mode).
	r.advance(119 * time.Second)
	r.cmd("autopilot", "c-1", "manual_start")
	acks := r.msgs("autopilot/cmd/ack")
	if len(acks) != len(raw)+1 || string(acks[len(acks)-1].payload) != string(firstBytes) {
		t.Fatalf("repeat was not answered with the same ack: %s", acks[len(acks)-1].payload)
	}
	if r.m.ap.mode != "manual" {
		t.Fatal("repeat changed the mode")
	}

	// A new id with the same command runs, and fails: manual is not idle.
	r.cmd("autopilot", "c-2", "manual_start")
	r.wantAck("autopilot", "c-2", "failed", "wrong_mode")

	// After the memory time the id is new again.
	r.advance(2 * time.Minute)
	r.cmd("autopilot", "c-1", "manual_start")
	if a := r.ack("autopilot", "c-1"); a["error"] != "wrong_mode" {
		t.Fatalf("an old id was still remembered after 2 minutes: %v", a)
	}
}

func TestCommandIDMemoryLongRunning(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(3, 0)))
	r.advance(time.Second)
	// While the command runs, a repeat gets the "accepted" ack again.
	n := len(r.acks("autopilot", "f"))
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(3, 0)))
	acks := r.acks("autopilot", "f")
	if len(acks) != n+1 || acks[len(acks)-1]["state"] != "accepted" {
		t.Fatalf("running repeat: %v", acks)
	}
	// After the end, the final ack.
	r.advance(10 * time.Second)
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(3, 0)))
	acks = r.acks("autopilot", "f")
	if last := acks[len(acks)-1]; last["state"] != "done" {
		t.Fatalf("finished repeat: %v", last)
	}
	// It ran once: still one path, back in idle.
	if r.m.ap.mode != "idle" {
		t.Fatalf("mode %s", r.m.ap.mode)
	}
}

func TestLostAcksAreAnsweredAgain(t *testing.T) {
	r := newRig(t).online()
	if err := r.m.set("drop-acks", "1"); err != nil {
		t.Fatal(err)
	}
	r.cmd("gateway", "g-1", "ping")
	if len(r.acks("gateway", "g-1")) != 0 {
		t.Fatal("the ack was not lost")
	}
	// The server asks again with the same id; the gateway answers from memory.
	r.cmd("gateway", "g-1", "ping")
	a := r.wantAck("gateway", "g-1", "done", "")
	if a["result"].(map[string]any)["pong"] != testName {
		t.Fatalf("%v", a)
	}
	// A lost "accepted" does not start a second path.
	_ = r.m.set("drop-acks", "1")
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(2, 0)))
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(2, 0)))
	r.wantAck("autopilot", "f", "accepted", "")
	r.advance(8 * time.Second)
	acks := r.acks("autopilot", "f")
	if acks[len(acks)-1]["state"] != "done" {
		t.Fatal("no final ack")
	}
	// Drop N acks.
	_ = r.m.set("drop-acks", "2")
	r.cmd("gateway", "g-2", "ping")
	r.cmd("gateway", "g-3", "ping")
	r.cmd("gateway", "g-4", "ping")
	if len(r.acks("gateway", "g-2"))+len(r.acks("gateway", "g-3")) != 0 || len(r.acks("gateway", "g-4")) != 1 {
		t.Fatal("drop-acks 2 did not drop exactly two acks")
	}
}

func TestReceiverChecks(t *testing.T) {
	r := newRig(t).online()
	for _, board := range []string{"gateway", "autopilot"} {
		for id, body := range map[string]string{
			"x1": `not json`,
		} {
			r.toMower(board+"/cmd", []byte(body))
			_ = id
		}
		r.cmd(board, "u-1", "dance")
		r.wantAck(board, "u-1", "failed", "unknown_cmd")
		r.cmd(board, "e-1", "ping", `"expires_at":1700000000`)
		r.wantAck(board, "e-1", "failed", "expired")
		r.cmd(board, "e-2", "ping", `"expires_at":"soon"`)
		r.wantAck(board, "e-2", "failed", "bad_request")
		r.cmd(board, "e-3", "ping", `"expires_at":`+"9999999999")
		if a := r.ack(board, "e-3"); a["error"] == "expired" {
			t.Fatalf("future expires_at refused: %v", a)
		}
		r.toMower(board+"/cmd", []byte(`{"cmd":"ping"}`))
		r.toMower(board+"/cmd", []byte(`{"id":"has space","cmd":"stop"}`))
		bad := 0
		for _, a := range r.takeJSON(board + "/cmd/ack") {
			if a["error"] == "bad_request" {
				bad++
			}
		}
		if bad != 4 {
			t.Fatalf("%s: %d bad_request acks, want 4", board, bad)
		}
	}
}

func TestNoClockRefusesExpiry(t *testing.T) {
	var sent [][]byte
	var drop = newRig(t).m.sw
	rc := newReceiver(2*time.Minute, func() time.Time { return epoch }, func() bool { return false }, &drop.dropAcks)
	rc.publish = func(p []byte) { sent = append(sent, p) }
	if _, ok := rc.accept([]byte(`{"id":"a","cmd":"stop","expires_at":1900000000}`)); ok || len(sent) != 1 {
		t.Fatal("not refused")
	}
	if got := string(sent[0]); !strings.Contains(got, `"error":"no_clock"`) || !strings.Contains(got, `"time":null`) {
		t.Fatalf("%s", got)
	}
	if _, ok := rc.accept([]byte(`{"id":"b","cmd":"stop"}`)); !ok {
		t.Fatal("a command without expires_at needs no clock")
	}
}

// ---- live driving (§9) ----------------------------------------------------------------

func TestLiveDrivingMovesAndStopsWithin500ms(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	r.events()
	x0, y0 := r.m.ap.x, r.m.ap.y
	seq := 0
	r.driveFor(&seq, 3*time.Second, 0.4, 0) // heading east
	if d := r.m.ap.x - x0; d < 0.8 || d > 1.4 {
		t.Fatalf("moved %.2f m east in 3 s at 0.4 m/s", d)
	}
	approx(t, "y", r.m.ap.y, y0, 0.05)
	if r.m.ap.speed < 0.35 {
		t.Fatalf("speed %.2f", r.m.ap.speed)
	}

	// The setpoints stop. Up to 0.5 s the last one holds; at 0.5 s the motors stop.
	r.advance(300 * time.Millisecond) // 0.4 s since the last setpoint
	if r.m.ap.speed == 0 {
		t.Fatal("stopped before the timeout")
	}
	if len(r.events()) != 0 {
		t.Fatal("event before the timeout")
	}
	r.advance(100 * time.Millisecond) // 0.5 s
	if r.m.ap.speed != 0 || r.m.ap.omega != 0 {
		t.Fatalf("not stopped within 0.5 s of the last setpoint: %.2f", r.m.ap.speed)
	}
	evs := r.events()
	if len(evs) != 1 || evs[0]["event"] != "drive_timeout" {
		t.Fatalf("events %v", evs)
	}
	// Once per stop.
	r.advance(5 * time.Second)
	if len(r.events()) != 0 {
		t.Fatal("drive_timeout repeated")
	}
	if r.m.ap.mode != "manual" {
		t.Fatal("the mode changed on a timeout")
	}
	// The next valid setpoint moves it again, whatever its seq.
	x := r.m.ap.x
	r.driveFor(&seq, time.Second, 0.4, 0)
	seq = 0
	r.driveFor(&seq, 0, 0, 0)
	r.drive(1, 0.4, 0)
	r.advance(500 * time.Millisecond)
	if r.m.ap.x <= x+0.1 {
		t.Fatal("did not move again")
	}
}

func TestLiveDrivingTimeoutSwitchesBladeOff(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	r.cmd("autopilot", "b", "blade", `"on":true`)
	r.drive(1, 0.2, 0)
	r.advance(600 * time.Millisecond)
	if r.m.ap.blade {
		t.Fatal("blade still on after a drive timeout")
	}
	if r.m.ap.mode != "manual" {
		t.Fatal("mode changed")
	}
}

func TestLiveDrivingSetpointRules(t *testing.T) {
	r := newRig(t).online()

	// Ignored outside manual and recording.
	r.drive(1, 0.5, 0)
	r.advance(200 * time.Millisecond)
	if r.m.ap.speed != 0 {
		t.Fatal("setpoint applied in idle")
	}
	r.cmd("autopilot", "m", "manual_start")

	// A setpoint with a seq not above the last applied one is dropped.
	r.drive(10, 0.5, 0)
	r.advance(100 * time.Millisecond)
	r.drive(10, -0.5, 0)
	r.drive(9, -0.5, 0)
	r.advance(100 * time.Millisecond)
	if r.m.ap.tgtV != 0.5 {
		t.Fatalf("an old seq was applied: v target %.2f", r.m.ap.tgtV)
	}
	r.drive(11, 0.3, 0)
	if r.m.ap.tgtV != 0.3 {
		t.Fatalf("a newer seq was not applied")
	}

	// More than 1 s old: dropped.
	r.toMower("autopilot/drive", []byte(`{"seq":12,"time":`+jsonNum(tf(r.now)-1.5)+`,"v":0.1,"w":0}`))
	if r.m.ap.tgtV != 0.3 {
		t.Fatal("a stale setpoint was applied")
	}
	r.toMower("autopilot/drive", []byte(`{"seq":13,"time":`+jsonNum(tf(r.now)-0.5)+`,"v":0.1,"w":0}`))
	if r.m.ap.tgtV != 0.1 {
		t.Fatal("a setpoint 0.5 s old was dropped")
	}

	// Clamped to the limits; w positive turns left (the heading decreases).
	r.drive(14, 50, 50)
	if r.m.ap.tgtV != maxSpeed || r.m.ap.tgtW != maxTurn {
		t.Fatalf("not clamped: %.2f %.2f", r.m.ap.tgtV, r.m.ap.tgtW)
	}
	r.drive(15, 0, 1)
	h := r.m.ap.heading
	r.advance(300 * time.Millisecond)
	if d := wrap180(r.m.ap.heading - h); d >= 0 {
		t.Fatalf("w > 0 did not turn left: heading change %.1f", d)
	}

	// Garbage is ignored.
	r.toMower("autopilot/drive", []byte(`not json`))
	r.toMower("autopilot/drive", []byte(`{"seq":16}`))
}

func jsonNum(f float64) string { return strconv.FormatFloat(f, 'f', 3, 64) }

func TestSeqForgottenOnModeEntry(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	r.drive(5000, 0.3, 0)
	r.cmd("autopilot", "s", "manual_stop")
	r.cmd("autopilot", "m2", "manual_start")
	r.drive(1, 0.2, 0) // the server may start counting anywhere
	if r.m.ap.tgtV != 0.2 {
		t.Fatal("seq was not forgotten when manual was entered again")
	}
}

func TestDriveWithoutClockSkipsAgeCheck(t *testing.T) {
	r := newRig(t)
	r.m.setMQTT(true)
	r.m.ap.mode = "manual"
	r.m.ap.clockSet = false
	r.m.ap.onDrive([]byte(`{"seq":1,"time":1,"v":0.2,"w":0}`), r.now)
	if r.m.ap.tgtV != 0.2 {
		t.Fatal("age check applied without a clock")
	}
}

// ---- recording (§10) --------------------------------------------------------------------

type batch struct {
	session string
	index   int
	fix     string
	points  [][2]float64
}

func (r *rig) batches() []batch {
	var out []batch
	for _, m := range r.takeJSON("autopilot/recording") {
		b := batch{session: m["session"].(string), index: int(m["index"].(float64)), fix: m["fix"].(string)}
		for _, p := range m["points"].([]any) {
			pp := p.([]any)
			b.points = append(b.points, [2]float64{pp[0].(float64), pp[1].(float64)})
		}
		out = append(out, b)
	}
	return out
}

func TestRecordingProducesPointBatches(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	r.cmd("autopilot", "rs", "record_start", `"session":"r-17"`)
	r.wantAck("autopilot", "rs", "done", "")
	seq := 0
	r.driveFor(&seq, 4*time.Second, 0.5, 0) // 2 m: about 20 points at 0.1 m
	var all []batch
	all = append(all, r.batches()...)
	if len(all) < 3 || len(all) > 5 {
		t.Fatalf("%d batches in 4 s, want about one per second", len(all))
	}
	next := 0
	for _, b := range all {
		if b.session != "r-17" || b.fix != "rtk_fixed" || len(b.points) > 50 || b.index != next {
			t.Fatalf("batch %+v, want index %d", b, next)
		}
		next += len(b.points)
	}
	// 0.1 m spacing: the points lie 0.1 m apart.
	pts := all[1].points
	x0, y0 := r.m.ap.toLocal(pts[0][0], pts[0][1])
	x1, y1 := r.m.ap.toLocal(pts[1][0], pts[1][1])
	approx(t, "spacing", math.Hypot(x1-x0, y1-y0), 0.1, 0.005)

	// record_stop publishes what is held, then acks with the number of points.
	r.cmd("autopilot", "rstop", "record_stop")
	tail := r.batches()
	for _, b := range tail {
		if b.index != next {
			t.Fatalf("tail batch index %d, want %d", b.index, next)
		}
		next += len(b.points)
	}
	a := r.wantAck("autopilot", "rstop", "done", "")
	if n := int(a["result"].(map[string]any)["index"].(float64)); n != next || n < 18 {
		t.Fatalf("record_stop index %d, points received %d", n, next)
	}
	if r.m.ap.mode != "manual" {
		t.Fatalf("mode after record_stop: %s", r.m.ap.mode)
	}
}

func TestRecordingBatchLimits(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "rs", "record_start", `"session":"r-1","spacing":0.01`)
	seq := 0
	r.m.ap.mode = "recording"
	r.driveFor(&seq, 6*time.Second, 0.6, 0) // ~360 points at 1 cm
	bs := r.batches()
	if len(bs) > 7 {
		t.Fatalf("%d batches in 6 s: more than one per second", len(bs))
	}
	for _, b := range bs {
		if len(b.points) > 50 {
			t.Fatalf("batch of %d points", len(b.points))
		}
	}
	r.cmd("autopilot", "rstop", "record_stop")
	total := 0
	for _, b := range bs {
		total += len(b.points)
	}
	for _, b := range r.batches() {
		if len(b.points) > 50 {
			t.Fatalf("tail batch of %d points", len(b.points))
		}
		total += len(b.points)
	}
	a := r.ack("autopilot", "rstop")
	if int(a["result"].(map[string]any)["index"].(float64)) != total {
		t.Fatalf("index %v, points %d", a["result"], total)
	}
}

func TestRecordingFixRules(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "rs", "record_start", `"session":"r-1"`)
	seq := 0
	_ = r.m.set("fix", "rtk_float")
	r.driveFor(&seq, 2*time.Second, 0.5, 0)
	r.advance(time.Second)
	bs := r.batches()
	if len(bs) == 0 {
		t.Fatal("no points with a float fix")
	}
	for _, b := range bs {
		if b.fix != "rtk_float" {
			t.Fatalf("batch fix %s", b.fix)
		}
	}
	// With a worse fix it takes none.
	_ = r.m.set("fix", "dgps")
	r.driveFor(&seq, 2*time.Second, 0.5, 0)
	r.advance(time.Second)
	if len(r.batches()) != 0 {
		t.Fatal("points with a dgps fix")
	}
	// The worst fix of a batch is reported. The first point after a pause goes
	// out at once; the next ones are batched for a second.
	_ = r.m.set("fix", "rtk_fixed")
	r.driveFor(&seq, 200*time.Millisecond, 0.5, 0)
	r.batches()
	r.driveFor(&seq, 400*time.Millisecond, 0.5, 0)
	_ = r.m.set("fix", "rtk_float")
	r.driveFor(&seq, 400*time.Millisecond, 0.5, 0)
	r.advance(time.Second)
	bs = r.batches()
	if len(bs) != 1 || bs[0].fix != "rtk_float" || len(bs[0].points) < 3 {
		t.Fatalf("mixed batch: %+v", bs)
	}
}

func TestRecordingStopsOnLinkLoss(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "rs", "record_start", `"session":"r-9"`)
	seq := 0
	r.driveFor(&seq, 2*time.Second, 0.5, 0)
	r.events()
	r.takeJSON("autopilot/recording")
	r.serverStatus("offline")
	r.advance(11 * time.Second)
	if r.m.ap.mode != "manual" {
		t.Fatalf("mode %s after the link was lost in recording", r.m.ap.mode)
	}
	var ev map[string]any
	for _, e := range r.events() {
		if e["event"] == "recording_stopped" {
			ev = e
		}
	}
	if ev == nil || ev["reason"] != "link" || ev["session"] != "r-9" || ev["index"].(float64) < 5 {
		t.Fatalf("recording_stopped: %v", ev)
	}
}

func TestRecordStartErrors(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "a", "record_start")
	r.wantAck("autopilot", "a", "failed", "bad_request")
	r.cmd("autopilot", "b", "record_start", `"session":"bad id"`)
	r.wantAck("autopilot", "b", "failed", "bad_request")
	r.cmd("autopilot", "c", "record_start", `"session":"ok","spacing":0`)
	r.wantAck("autopilot", "c", "failed", "bad_request")
	if r.m.ap.mode != "idle" {
		t.Fatal("mode changed on a refused record_start")
	}
}
