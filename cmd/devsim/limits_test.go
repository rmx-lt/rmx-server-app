package main

import (
	"fmt"
	"math"
	"testing"
	"time"
)

// Segment types and speed limits (§7.1, §8, §11).

func (r *rig) setLimits(id, limits string) map[string]any {
	r.t.Helper()
	r.cmd("autopilot", id, "speed_limit", `"limits":`+limits)
	return r.wantAck("autopilot", id, "done", "")
}

func (r *rig) stateLimit(name string) float64 {
	r.advance(100 * time.Millisecond)
	l, _ := r.apState()["speed_limit"].(map[string]any)
	v, _ := l[name].(float64)
	return v
}

func TestSpeedLimitDefaultsSetAndNull(t *testing.T) {
	r := newRig(t).online()
	for n, want := range defaultLimits {
		if got := r.stateLimit(n); got != want {
			t.Fatalf("default %s: %v, want %v", n, got, want)
		}
	}
	// Only the named limits change; the result is the object as it now is.
	res := r.setLimits("s1", `{"edge":0.1,"fill":0}`)["result"].(map[string]any)
	if res["edge"] != 0.1 || res["fill"] != 0.0 || res["max"] != defaultLimits["max"] {
		t.Fatalf("result: %v", res)
	}
	if r.stateLimit("edge") != 0.1 || r.stateLimit("fill") != 0 || r.stateLimit("manual") != defaultLimits["manual"] {
		t.Fatalf("state: %v", r.apState())
	}
	// null returns a limit to the firmware's default.
	r.setLimits("s2", `{"edge":null}`)
	if got := r.stateLimit("edge"); got != defaultLimits["edge"] {
		t.Fatalf("edge after null: %v", got)
	}
	if got := r.stateLimit("fill"); got != 0 {
		t.Fatalf("fill changed by a command that did not name it: %v", got)
	}
}

func TestSpeedLimitRejects(t *testing.T) {
	r := newRig(t).online()
	for i, limits := range []string{`{}`, `[1]`, `1`, `{"top":1}`, `{"max":-1}`, `{"max":"1"}`, `{"edge":0.2,"fill":-0.5}`} {
		id := fmt.Sprint("b", i)
		r.cmd("autopilot", id, "speed_limit", `"limits":`+limits)
		r.wantAck("autopilot", id, "failed", "bad_request")
	}
	r.cmd("autopilot", "b-none", "speed_limit")
	r.wantAck("autopilot", "b-none", "failed", "bad_request")
	// A failed command changes nothing, also the valid part of it.
	for n, want := range defaultLimits {
		if got := r.stateLimit(n); got != want {
			t.Fatalf("%s changed to %v by a refused command", n, got)
		}
	}
}

func TestSpeedLimitFallsBackToMaxAndTopSpeed(t *testing.T) {
	r := newRig(t).online()
	a := r.m.ap
	r.setLimits("s1", `{"max":0.2,"transit":0.4,"edge":0,"fill":0.1}`)
	for kind, want := range map[string]float64{"transit": 0.2, "edge": 0.2, "fill": 0.1, "manual": 0.2} {
		if got := a.limitFor(kind); got != want {
			t.Fatalf("%s with max 0.2: %v, want %v", kind, got, want)
		}
	}
	// 0 for a type: limited by max alone. With max 0 as well: the top speed.
	r.setLimits("s2", `{"max":0,"edge":0,"transit":0.3}`)
	if got := a.limitFor("edge"); got != maxSpeed {
		t.Fatalf("edge 0 and max 0: %v, want the top speed %v", got, maxSpeed)
	}
	if got := a.limitFor("transit"); got != 0.3 {
		t.Fatalf("transit 0.3 and max 0: %v", got)
	}
	// There is no ceiling on the limits, but the simulator never goes above its top speed.
	r.setLimits("s3", `{"max":50,"fill":99}`)
	if got := a.limitFor("fill"); got != maxSpeed {
		t.Fatalf("fill 99: %v", got)
	}
}

func TestSpeedLimitsLimitLiveDriving(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	r.setLimits("s1", `{"manual":0.25}`)
	seq := 0
	r.driveFor(&seq, 2*time.Second, 0.6, 0)
	if v := r.m.ap.speed; math.Abs(v-0.25) > 0.01 {
		t.Fatalf("speed %v with manual 0.25", v)
	}
	// Backwards is limited the same; max limits below manual; a change applies at once.
	r.setLimits("s2", `{"max":0.1}`)
	r.advance(300 * time.Millisecond) // inside the 0.5 s drive timeout
	if v := r.m.ap.speed; math.Abs(v-0.1) > 0.01 {
		t.Fatalf("speed %v after max 0.1, without a new setpoint", v)
	}
	r.driveFor(&seq, 2*time.Second, -0.6, 0)
	if v := r.m.ap.speed; math.Abs(v+0.1) > 0.01 {
		t.Fatalf("speed %v backwards with max 0.1", v)
	}
}

func TestSpeedLimitsSurviveRestart(t *testing.T) {
	r := newRig(t).online()
	r.setLimits("s1", `{"max":0.45,"edge":0.12}`)
	r.cmd("autopilot", "rs", "restart")
	r.wantAck("autopilot", "rs", "done", "")
	r.advance(4 * time.Second)
	if s := r.apState(); s["boot"].(float64) != 2 {
		t.Fatalf("boot %v", s["boot"])
	}
	if r.stateLimit("max") != 0.45 || r.stateLimit("edge") != 0.12 || r.stateLimit("fill") != defaultLimits["fill"] {
		t.Fatalf("limits after a restart: %v", r.apState()["speed_limit"])
	}
}

func TestFollowType(t *testing.T) {
	r := newRig(t).online()
	// Without type: transit, blade off.
	r.cmd("autopilot", "f1", "follow", pointsJSON(r.geo(20, 0)))
	r.wantAck("autopilot", "f1", "accepted", "")
	r.advance(time.Second)
	if r.m.ap.blade || r.m.ap.path.types[0] != "transit" {
		t.Fatalf("follow without type: blade %v, type %v", r.m.ap.blade, r.m.ap.path.types)
	}
	r.cmd("autopilot", "st", "stop")
	for typ, blade := range map[string]bool{"transit": false, "edge": true, "fill": true} {
		r.cmd("autopilot", "f-"+typ, "follow", pointsJSON(r.geo(20, 0)), `"type":"`+typ+`"`)
		r.wantAck("autopilot", "f-"+typ, "accepted", "")
		r.advance(time.Second)
		if r.m.ap.blade != blade {
			t.Fatalf("type %s: blade %v", typ, r.m.ap.blade)
		}
		r.cmd("autopilot", "st-"+typ, "stop")
	}
	r.cmd("autopilot", "f-bad", "follow", pointsJSON(r.geo(20, 0)), `"type":"mow"`)
	r.wantAck("autopilot", "f-bad", "failed", "bad_request")
	r.cmd("autopilot", "f-null", "follow", pointsJSON(r.geo(20, 0)), `"type":5`)
	r.wantAck("autopilot", "f-null", "failed", "bad_request")
}

func TestPathUnknownSegmentTypeIsBadPath(t *testing.T) {
	r := newRig(t).online()
	r.startPath("j-t", pathFile("j-t", seg{"transit", [][2]float64{r.geo(1, 0)}}, seg{"mow", [][2]float64{r.geo(2, 0)}}))
	r.advance(time.Second)
	r.wantAck("autopilot", "c-j-t", "failed", "bad_path")
	r.startPath("j-n", pathFile("j-n", seg{"", [][2]float64{r.geo(1, 0)}}))
	r.advance(time.Second)
	r.wantAck("autopilot", "c-j-n", "failed", "bad_path")
}

// A new limit applies to a path that is running, and each type has its own.
func TestSpeedLimitChangesRunningPath(t *testing.T) {
	r := newRig(t).online()
	r.setLimits("s0", `{"max":0,"edge":0.2}`)
	r.startPath("j-s", pathFile("j-s", seg{"edge", [][2]float64{r.geo(0, 0.05), r.geo(0, 60)}}))
	r.advance(5 * time.Second)
	if v := r.m.ap.speed; math.Abs(v-0.2) > 0.01 {
		t.Fatalf("edge speed %v, want 0.2", v)
	}
	r.setLimits("s1", `{"edge":0.5}`)
	r.advance(2 * time.Second)
	if v := r.m.ap.speed; math.Abs(v-0.5) > 0.01 {
		t.Fatalf("edge speed %v after the change, want 0.5", v)
	}
}
