package main

import (
	"strings"
	"testing"
	"time"
)

// The state machine of §8, written from the contract's table, not from the code.

var sha64 = strings.Repeat("a", 64)

// cmdParams are minimal valid parameters for each command, so that a command
// that is allowed in a mode gets past the parameter checks.
func cmdParams(r *rig, cmd string) []string {
	switch cmd {
	case "blade":
		return []string{`"on":true`}
	case "speed_limit":
		return []string{`"limits":{"edge":0.3}`}
	case "follow":
		return []string{pointsJSON(r.geo(30, 0))}
	case "record_start":
		return []string{`"session":"r-1"`}
	case "path_start":
		return []string{`"path":"j-1","size":10,"sha256":"` + sha64 + `"`}
	case "monitor_start":
		return []string{`"session":"m-1","metrics":["battery.v"],"rate":10`}
	case "ota":
		return []string{`"version":"9.9.9"`}
	}
	return nil
}

// inMode brings the autopilot into a mode.
func inMode(r *rig, mode string) {
	r.t.Helper()
	switch mode {
	case "idle":
	case "manual":
		r.cmd("autopilot", "p-manual", "manual_start")
	case "recording":
		r.cmd("autopilot", "p-manual", "manual_start")
		r.cmd("autopilot", "p-rec", "record_start", `"session":"r-0"`)
	case "path":
		r.cmd("autopilot", "p-follow", "follow", pointsJSON(r.geo(40, 0)))
	case "fault":
		if err := r.m.set("fault", "motor_stall"); err != nil {
			r.t.Fatal(err)
		}
		r.advance(100 * time.Millisecond)
	}
	if got := r.m.ap.mode; got != mode {
		r.t.Fatalf("could not enter mode %s, in %s", mode, got)
	}
}

func TestStateMachineTable(t *testing.T) {
	any5 := []string{"idle", "manual", "recording", "path", "fault"}
	// §8, "Allowed in".
	allowed := map[string][]string{
		"stop":          any5,
		"manual_start":  {"idle"},
		"manual_stop":   {"manual"},
		"blade":         {"manual", "recording"},
		"speed_limit":   any5,
		"follow":        {"idle", "manual"},
		"record_start":  {"idle", "manual"},
		"record_stop":   {"recording"},
		"path_start":    {"idle"},
		"pause":         {"path"},
		"resume":        {"path"},
		"clear_fault":   {"fault"},
		"monitor_start": any5,
		"monitor_stop":  any5,
		"ota":           {"idle"},
		"restart":       {"idle", "fault"},
	}
	for cmd, modes := range allowed {
		for _, mode := range any5 {
			t.Run(cmd+"/"+mode, func(t *testing.T) {
				r := newRig(t).online()
				inMode(r, mode)
				r.cmd("autopilot", "t-1", cmd, cmdParams(r, cmd)...)
				a := r.ack("autopilot", "t-1")
				if contains(modes, mode) {
					if a["error"] == "wrong_mode" {
						t.Fatalf("%s must be allowed in %s: %v", cmd, mode, a)
					}
				} else if a["error"] != "wrong_mode" || a["state"] != "failed" || a["ok"] != false {
					t.Fatalf("%s in %s must fail with wrong_mode: %v", cmd, mode, a)
				}
			})
		}
	}
}

func TestStateMachineTransitions(t *testing.T) {
	r := newRig(t).online()
	mode := func() string { return r.apState()["mode"].(string) }
	step := func(id, cmd string, wantMode string, params ...string) {
		t.Helper()
		r.cmd("autopilot", id, cmd, params...)
		r.advance(100 * time.Millisecond)
		if a := r.ack("autopilot", id); a["state"] != "done" {
			t.Fatalf("%s: %v", cmd, a)
		}
		if got := mode(); got != wantMode {
			t.Fatalf("after %s: mode %s, want %s", cmd, got, wantMode)
		}
	}
	step("a1", "manual_start", "manual")
	step("a2", "record_start", "recording", `"session":"r-1"`)
	if r.apState()["recording"] != "r-1" {
		t.Fatalf("recording session not in state: %v", r.apState())
	}
	step("a3", "record_stop", "manual")
	step("a4", "manual_stop", "idle")
	step("a5", "manual_start", "manual")
	step("a6", "stop", "idle")
	step("a7", "record_start", "recording", `"session":"r-2"`) // idle allows record_start
	step("a8", "stop", "idle")
	if r.apState()["recording"] != nil {
		t.Fatalf("recording not cleared: %v", r.apState())
	}

	// follow from manual returns to manual; from idle to idle.
	step("b1", "manual_start", "manual")
	r.cmd("autopilot", "b2", "follow", pointsJSON(r.geo(0.4, 0)))
	r.advance(100 * time.Millisecond)
	if mode() != "path" {
		t.Fatalf("follow: mode %s", mode())
	}
	r.advance(5 * time.Second)
	r.wantAck("autopilot", "b2", "done", "")
	if mode() != "manual" {
		t.Fatalf("after follow from manual: %s", mode())
	}
}

func TestStopIsAcceptedEverywhere(t *testing.T) {
	for _, mode := range []string{"idle", "manual", "recording", "path", "fault"} {
		r := newRig(t).online()
		inMode(r, mode)
		r.cmd("autopilot", "s-1", "stop")
		r.advance(100 * time.Millisecond)
		r.wantAck("autopilot", "s-1", "done", "")
		want := "idle"
		if mode == "fault" {
			want = "fault" // §8: fault stays fault
		}
		if got := r.apState()["mode"]; got != want {
			t.Errorf("stop in %s: mode %v, want %s", mode, got, want)
		}
	}
}

func TestLongRunningAcks(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f-1", "follow", pointsJSON(r.geo(0.5, 0)))
	a := r.wantAck("autopilot", "f-1", "accepted", "")
	if a["ok"] != true {
		t.Fatal(a)
	}
	r.advance(6 * time.Second)
	acks := r.acks("autopilot", "f-1")
	if len(acks) != 2 || acks[1]["state"] != "done" || acks[1]["result"] == nil {
		t.Fatalf("want accepted then done with a result: %v", acks)
	}

	// stop ends a path with the final ack "cancelled".
	r.cmd("autopilot", "f-2", "follow", pointsJSON(r.geo(30, 0)))
	r.advance(time.Second)
	r.cmd("autopilot", "f-3", "stop")
	r.wantAck("autopilot", "f-2", "failed", "cancelled")
	r.wantAck("autopilot", "f-3", "done", "")
	r.advance(100 * time.Millisecond)
	if r.apState()["mode"] != "idle" {
		t.Fatal("not idle after stop")
	}
}

func TestFollowErrors(t *testing.T) {
	r := newRig(t).online()
	for id, params := range map[string][]string{
		"e1": {},
		"e2": {`"points":[]`},
		"e3": {`"points":[[1]]`},
		"e4": {`"points":[[91,0]]`},
		"e5": {pointsJSON(r.geo(1, 0)), `"type":"mow"`},
		"e6": {pointsJSON(r.geo(1, 0)), `"reverse":"yes"`},
	} {
		r.cmd("autopilot", id, "follow", params...)
		r.wantAck("autopilot", id, "failed", "bad_request")
	}
	var many [][2]float64
	for i := 0; i < 101; i++ {
		many = append(many, r.geo(float64(i)*0.1, 0))
	}
	r.cmd("autopilot", "e7", "follow", pointsJSON(many...))
	r.wantAck("autopilot", "e7", "failed", "bad_request")
	var hundred [][2]float64
	for i := 0; i < 100; i++ {
		hundred = append(hundred, r.geo(float64(i)*0.1, 0))
	}
	r.cmd("autopilot", "e8", "follow", pointsJSON(hundred...))
	r.wantAck("autopilot", "e8", "accepted", "")

	// no_fix without a fixed solution; the mode stays.
	r = newRig(t).online()
	_ = r.m.set("fix", "rtk_float")
	r.cmd("autopilot", "n1", "follow", pointsJSON(r.geo(1, 0)))
	r.wantAck("autopilot", "n1", "failed", "no_fix")
	r.cmd("autopilot", "n2", "path_start", `"path":"j","size":1,"sha256":"`+sha64+`"`)
	r.wantAck("autopilot", "n2", "failed", "no_fix")
	if r.m.ap.mode != "idle" {
		t.Fatal("mode changed on no_fix")
	}
}

func TestFollowReverseKeepsHeading(t *testing.T) {
	r := newRig(t).online()
	// Heading starts at 90° (east). A point 1 m to the west behind the mower is
	// reached by driving backwards, without turning round.
	r.cmd("autopilot", "rv", "follow", pointsJSON(r.geo(-1, 0)), `"reverse":true`)
	r.advance(8 * time.Second)
	r.wantAck("autopilot", "rv", "done", "")
	approx(t, "heading", r.m.ap.heading, 90, 3)
	approx(t, "x", r.m.ap.x, -1, 0.2)

	// Without reverse the mower turns round and drives there.
	r2 := newRig(t).online()
	r2.cmd("autopilot", "fw", "follow", pointsJSON(r2.geo(-1, 0)))
	r2.advance(12 * time.Second)
	r2.wantAck("autopilot", "fw", "done", "")
	approx(t, "heading", r2.m.ap.heading, 270, 25)
}

func TestFollowBlade(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "b1", "follow", pointsJSON(r.geo(2, 0)), `"type":"fill"`)
	r.advance(2 * time.Second)
	if !r.m.ap.blade {
		t.Fatal("blade off during a follow of type fill")
	}
	r.advance(10 * time.Second)
	r.wantAck("autopilot", "b1", "done", "")
	if r.m.ap.blade {
		t.Fatal("blade on after the path")
	}
	r.cmd("autopilot", "b2", "follow", pointsJSON(r.geo(4, 0)))
	r.advance(2 * time.Second)
	if r.m.ap.blade {
		t.Fatal("blade on in a follow without type")
	}
}

func TestBladeRules(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	r.cmd("autopilot", "bl", "blade", `"on":true`)
	if !r.m.ap.blade {
		t.Fatal("blade command did not switch the blade on")
	}
	r.cmd("autopilot", "bl2", "blade")
	r.wantAck("autopilot", "bl2", "failed", "bad_request")
	// Every mode change switches it off.
	r.cmd("autopilot", "rs", "record_start", `"session":"r-1"`)
	if r.m.ap.blade {
		t.Fatal("blade still on after a mode change")
	}
	r.cmd("autopilot", "bl3", "blade", `"on":true`)
	r.cmd("autopilot", "st", "stop")
	if r.m.ap.blade {
		t.Fatal("blade on after stop")
	}
}

func TestPauseResume(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(3, 0)), `"type":"fill"`)
	r.advance(2 * time.Second)
	r.cmd("autopilot", "p1", "pause")
	r.wantAck("autopilot", "p1", "done", "")
	r.advance(100 * time.Millisecond)
	if r.apState()["paused"] != "command" {
		t.Fatalf("paused: %v", r.apState()["paused"])
	}
	x := r.m.ap.x
	r.advance(2 * time.Second)
	approx(t, "x while paused", r.m.ap.x, x, 0.001)
	if r.m.ap.blade {
		t.Fatal("blade on while paused")
	}
	r.cmd("autopilot", "p2", "pause") // done also when already paused
	r.wantAck("autopilot", "p2", "done", "")
	r.cmd("autopilot", "r1", "resume")
	r.wantAck("autopilot", "r1", "done", "")
	r.advance(100 * time.Millisecond)
	if r.apState()["paused"] != nil {
		t.Fatal("still paused after resume")
	}
	if !r.m.ap.blade {
		t.Fatal("blade did not come back after resume inside a blade-on path")
	}
	r.cmd("autopilot", "r2", "resume") // done also when not paused
	r.wantAck("autopilot", "r2", "done", "")
	r.advance(10 * time.Second)
	r.wantAck("autopilot", "f", "done", "")

	// resume without a fixed solution: no_fix, and it stays paused.
	r = newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(30, 0)))
	r.advance(time.Second)
	r.cmd("autopilot", "p", "pause")
	_ = r.m.set("fix", "rtk_float")
	r.cmd("autopilot", "r", "resume")
	r.wantAck("autopilot", "r", "failed", "no_fix")
	if r.m.ap.paused == nil {
		t.Fatal("resumed without a fix")
	}
}

func TestFixLossPausesAndResumes(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(40, 0)), `"type":"fill"`)
	r.advance(2 * time.Second)
	r.events()
	_ = r.m.set("fix", "rtk_float")
	r.advance(time.Second) // within the grace period the path goes on
	if r.m.ap.paused != nil {
		t.Fatal("paused at once")
	}
	r.advance(3 * time.Second)
	if p := r.apState()["paused"]; p != "fix" {
		t.Fatalf("paused = %v, want fix", p)
	}
	if r.m.ap.blade {
		t.Fatal("blade on while paused")
	}
	evs := r.events()
	names := eventNames(evs)
	if !contains(names, "fix_lost") || !contains(names, "path_paused") {
		t.Fatalf("events %v", names)
	}
	for _, e := range evs {
		if e["event"] == "fix_lost" && e["fix"] != "rtk_float" {
			t.Fatalf("fix_lost: %v", e)
		}
		if e["event"] == "path_paused" && e["reason"] != "fix" {
			t.Fatalf("path_paused: %v", e)
		}
	}
	_ = r.m.set("fix", "rtk_fixed")
	r.advance(500 * time.Millisecond)
	names = eventNames(r.events())
	if !contains(names, "fix_regained") || !contains(names, "path_resumed") {
		t.Fatalf("events after fix returned: %v", names)
	}
	if r.m.ap.paused != nil {
		t.Fatal("did not continue by itself")
	}
	if !r.m.ap.blade {
		t.Fatal("blade did not come back after a pause for the fix")
	}
}

func TestLinkLossPausesPathUntilResume(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(40, 0)), `"type":"fill"`)
	r.advance(2 * time.Second)
	r.events()
	r.serverStatus("offline")
	r.advance(9 * time.Second) // shorter drops change nothing
	if r.m.ap.paused != nil {
		t.Fatal("paused before 10 s")
	}
	r.advance(2500 * time.Millisecond)
	if p := r.apState()["paused"]; p != "link" {
		t.Fatalf("paused = %v, want link", p)
	}
	if !contains(eventNames(r.events()), "path_paused") {
		t.Fatal("no path_paused event")
	}
	r.serverStatus("online")
	r.advance(3 * time.Second)
	if r.apState()["paused"] != "link" {
		t.Fatal("did not stay paused when the link returned")
	}
	if r.m.ap.blade {
		t.Fatal("blade on while paused for the link")
	}
	r.cmd("autopilot", "r", "resume")
	r.wantAck("autopilot", "r", "done", "")
	r.advance(100 * time.Millisecond)
	if r.apState()["paused"] != nil {
		t.Fatal("resume did not continue")
	}
	if !r.m.ap.blade {
		t.Fatal("blade did not come back after resume from a link pause")
	}
}

func TestShortLinkDropChangesNothing(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(40, 0)))
	r.advance(time.Second)
	r.serverStatus("offline")
	r.advance(8 * time.Second)
	r.serverStatus("online")
	r.advance(15 * time.Second)
	if r.m.ap.paused != nil {
		t.Fatal("a drop shorter than 10 s paused the path")
	}
}

func TestFixPauseBecomesLinkPause(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(40, 0)))
	r.advance(time.Second)
	_ = r.m.set("fix", "none")
	r.advance(4 * time.Second)
	if r.m.ap.paused == nil || *r.m.ap.paused != "fix" {
		t.Fatal("not paused for the fix")
	}
	r.serverStatus("offline")
	r.advance(11 * time.Second)
	if p := r.apState()["paused"]; p != "link" {
		t.Fatalf("paused = %v, want link", p)
	}
	_ = r.m.set("fix", "rtk_fixed")
	r.advance(time.Second)
	if r.m.ap.paused == nil {
		t.Fatal("a path paused for the link continued with the fix")
	}
}

func TestFaults(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(40, 0)), `"type":"fill"`)
	r.advance(2 * time.Second)
	r.events()
	_ = r.m.set("fault", "motor_stall")
	r.advance(100 * time.Millisecond)
	s := r.apState()
	f, _ := s["fault"].(map[string]any)
	if s["mode"] != "fault" || f["code"] != "motor_stall" || f["message"] == "" {
		t.Fatalf("state after a fault: %v", s)
	}
	// The running command ends with the fault code.
	r.wantAck("autopilot", "f", "failed", "motor_stall")
	evs := r.events()
	if len(evs) != 1 || evs[0]["event"] != "fault" || evs[0]["code"] != "motor_stall" {
		t.Fatalf("events: %v", evs)
	}
	if r.m.ap.blade || r.m.ap.speed != 0 {
		t.Fatal("not stopped in fault")
	}
	// Motion is refused; stop leaves fault.
	r.cmd("autopilot", "g", "follow", pointsJSON(r.geo(1, 0)))
	r.wantAck("autopilot", "g", "failed", "wrong_mode")
	r.cmd("autopilot", "h", "manual_start")
	r.wantAck("autopilot", "h", "failed", "wrong_mode")
	// clear_fault fails with the code while the cause is there.
	r.cmd("autopilot", "c1", "clear_fault")
	r.wantAck("autopilot", "c1", "failed", "motor_stall")
	if r.m.ap.mode != "fault" {
		t.Fatal("left fault with the cause present")
	}
	_ = r.m.set("fault", "none")
	r.cmd("autopilot", "c2", "clear_fault")
	r.wantAck("autopilot", "c2", "done", "")
	r.advance(100 * time.Millisecond)
	if r.apState()["mode"] != "idle" || r.apState()["fault"] != nil {
		t.Fatalf("after clear_fault: %v", r.apState())
	}
	if !contains(eventNames(r.events()), "fault_cleared") {
		t.Fatal("no fault_cleared event")
	}
}

func TestFaultFromAnyMode(t *testing.T) {
	for _, mode := range []string{"idle", "manual", "recording", "path"} {
		for _, code := range faultCodes {
			r := newRig(t).online()
			inMode(r, mode)
			_ = r.m.set("fault", code)
			r.advance(100 * time.Millisecond)
			if r.m.ap.mode != "fault" || r.m.ap.fault.Code != code {
				t.Errorf("%s/%s: mode %s", mode, code, r.m.ap.mode)
			}
		}
	}
}

func TestBatteryWarnAndCritical(t *testing.T) {
	r := newRig(t).online()
	r.events()
	_ = r.m.set("battery", "14")
	r.advance(100 * time.Millisecond)
	evs := r.events()
	if len(evs) != 1 || evs[0]["event"] != "battery_low" || evs[0]["v"] == nil {
		t.Fatalf("warning: %v", evs)
	}
	r.advance(time.Second)
	if len(r.events()) != 0 {
		t.Fatal("the warning repeated")
	}
	_ = r.m.set("battery", "5")
	r.advance(100 * time.Millisecond)
	if r.m.ap.mode != "fault" || r.m.ap.fault.Code != "battery_low" {
		t.Fatalf("critical level: %s", r.m.ap.mode)
	}
	r.cmd("autopilot", "c", "clear_fault")
	r.wantAck("autopilot", "c", "failed", "battery_low")
}

func TestEventsHaveBootAndSeq(t *testing.T) {
	r := newRig(t).online()
	_ = r.m.set("fix", "none")
	r.advance(100 * time.Millisecond)
	_ = r.m.set("fix", "rtk_fixed")
	r.advance(100 * time.Millisecond)
	evs := r.takeJSON("autopilot/event")
	if len(evs) < 3 || evs[0]["event"] != "boot" || evs[0]["seq"].(float64) != 0 {
		t.Fatalf("events: %v", evs)
	}
	if evs[0]["firmware"] == nil || evs[0]["reason"] == nil {
		t.Fatalf("boot event: %v", evs[0])
	}
	for i, e := range evs {
		if int(e["seq"].(float64)) != i || e["boot"].(float64) != 1 || e["time"] == nil && i > 0 {
			t.Fatalf("event %d: %v", i, e)
		}
	}
}
