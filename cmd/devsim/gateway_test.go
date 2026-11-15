package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func statusTexts(r *rig) []string {
	var out []string
	for _, m := range r.msgs("gateway/status") {
		out = append(out, string(m.payload))
	}
	return out
}

func TestGatewayStatusAndLastWill(t *testing.T) {
	r := newRig(t)
	if len(r.msgs("gateway/status")) != 0 {
		t.Fatal("status before the connection")
	}
	r.m.setMQTT(true)
	if got := statusTexts(r); len(got) != 1 || got[0] != "online" {
		t.Fatalf("status after connect: %v", got)
	}
	// Cut off: the will says offline; back: online again.
	_ = r.m.set("link", "down")
	_ = r.m.set("link", "up")
	if got := statusTexts(r); strings.Join(got, ",") != "online,offline,online" {
		t.Fatalf("status: %v", got)
	}
}

func TestGatewayPingAndErrors(t *testing.T) {
	r := newRig(t).online()
	r.cmd("gateway", "p", "ping")
	a := r.wantAck("gateway", "p", "done", "")
	if a["result"].(map[string]any)["pong"] != testName || a["ok"] != true || a["time"] == nil {
		t.Fatalf("%v", a)
	}
	r.cmd("gateway", "f", "follow") // an autopilot command
	r.wantAck("gateway", "f", "failed", "unknown_cmd")
	r.cmd("autopilot", "g", "ntrip_clear") // a gateway command
	r.wantAck("autopilot", "g", "failed", "unknown_cmd")
}

func TestGatewayRestart(t *testing.T) {
	r := newRig(t).online()
	r.advance(5 * time.Second)
	if r.gwState()["boot"].(float64) != 1 {
		t.Fatal("boot")
	}
	r.cmd("gateway", "rs", "restart")
	r.wantAck("gateway", "rs", "done", "") // acks, then restarts
	if got := statusTexts(r); got[len(got)-1] != "offline" {
		t.Fatalf("status after restart: %v", got)
	}
	r.advance(3 * time.Second)
	if got := statusTexts(r); got[len(got)-1] != "offline" {
		t.Fatal("back too early")
	}
	r.advance(5 * time.Second)
	if got := statusTexts(r); got[len(got)-1] != "online" {
		t.Fatalf("not back: %v", got)
	}
	r.advance(2 * time.Second)
	if s := r.gwState(); s["boot"].(float64) != 2 {
		t.Fatalf("boot after restart: %v", s["boot"])
	}
	// Its counters start again from 0 under the new boot (§16.3).
	r.advance(time.Second)
	var last map[string]any
	for _, m := range r.takeJSON("gateway/telemetry") {
		last = m
	}
	if last["boot"].(float64) != 2 {
		t.Fatalf("telemetry boot %v", last["boot"])
	}
	if up := last["metrics"].(map[string]any)["usage.total.up"].(float64); up > 20000 {
		t.Fatalf("counter did not restart from 0: %v", up)
	}
	// The autopilot kept running: no new boot.
	if r.m.ap.st.Boot != 1 {
		t.Fatal("the autopilot restarted with the gateway")
	}
}

func TestAutopilotRestartAndReset(t *testing.T) {
	r := newRig(t).online()
	r.events()
	r.cmd("autopilot", "rs", "restart")
	r.wantAck("autopilot", "rs", "done", "")
	r.advance(4 * time.Second)
	if s := r.apState(); s["boot"].(float64) != 2 {
		t.Fatalf("boot %v", s["boot"])
	}
	evs := r.events()
	if len(evs) == 0 || evs[0]["event"] != "boot" || evs[0]["boot"].(float64) != 2 || evs[0]["seq"].(float64) != 0 || evs[0]["reason"] != "command" {
		t.Fatalf("events after a restart: %v", evs)
	}
	// autopilot_reset on the gateway pulses the reset line.
	r.cmd("gateway", "ar", "autopilot_reset")
	r.wantAck("gateway", "ar", "done", "")
	r.advance(4 * time.Second)
	if r.apState()["boot"].(float64) != 3 {
		t.Fatalf("no restart after autopilot_reset")
	}
}

func TestAutopilotLinkStates(t *testing.T) {
	r := newRig(t).online()
	if r.gwState()["autopilot_link"] != "up" {
		t.Fatal("link not up")
	}
	_ = r.m.set("board-link", "down")
	r.advance(2 * time.Second)
	if r.gwState()["autopilot_link"] != "up" {
		t.Fatal("down before 3 s without a heartbeat")
	}
	r.advance(2 * time.Second)
	if r.gwState()["autopilot_link"] != "down" {
		t.Fatal("not down after 3 s")
	}
	// The autopilot's messages do not reach the server and its commands are lost.
	r.takeJSON("autopilot/cmd/ack")
	r.cmd("autopilot", "x", "manual_start")
	r.advance(time.Second)
	if len(r.acks("autopilot", "x")) != 0 || r.m.ap.mode != "idle" {
		t.Fatal("a command passed a cut board link")
	}
	if r.m.gw.dropped == 0 {
		t.Fatal("dropped commands are not counted (link.dropped)")
	}
	// The server asks again with the same id once the link is back.
	_ = r.m.set("board-link", "up")
	r.advance(2 * time.Second)
	if r.gwState()["autopilot_link"] != "up" {
		t.Fatal("link did not come back")
	}
	r.cmd("autopilot", "x", "manual_start")
	r.wantAck("autopilot", "x", "done", "")
	// The autopilot published its state and catalogue again.
	if len(r.msgs("autopilot/metrics/index")) < 2 {
		t.Fatal("no catalogue after the board link came back")
	}
}

func TestBoardLinkLossIsServerLinkLossForTheAutopilot(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "f", "follow", pointsJSON(r.geo(40, 0)))
	r.advance(time.Second)
	_ = r.m.set("board-link", "down")
	r.advance(12 * time.Second)
	if r.m.ap.paused != nil {
		t.Fatal("paused before 3 s + 10 s")
	}
	r.advance(2 * time.Second)
	if r.m.ap.paused == nil || *r.m.ap.paused != "link" {
		t.Fatalf("paused %v", r.m.ap.paused)
	}
}

func TestNTRIP(t *testing.T) {
	r := newRig(t).online()
	r.cmd("gateway", "n1", "ntrip_set", `"host":"caster.example","port":2101`, `"mountpoint":"MOUNT","user":"someone","password":"ntrip-test-pass"`)
	r.wantAck("gateway", "n1", "done", "")
	r.advance(time.Second)
	if r.gwState()["ntrip"] != "connecting" {
		t.Fatalf("ntrip %v", r.gwState()["ntrip"])
	}
	r.advance(3 * time.Second)
	if r.gwState()["ntrip"] != "streaming" {
		t.Fatalf("ntrip %v", r.gwState()["ntrip"])
	}
	// The password is never reported back.
	for _, m := range r.out {
		if bytes.Contains(m.payload, []byte("ntrip-test-pass")) {
			t.Fatalf("the password is in %s", m.topic)
		}
	}
	// Corrections are traffic of their own.
	r.advance(20 * time.Second)
	if v := r.m.gw.value("usage.ntrip.down").(uint64); v < 5000 {
		t.Fatalf("ntrip down %d", v)
	}
	_ = r.m.set("ntrip", "error")
	r.advance(time.Second)
	if r.gwState()["ntrip"] != "error" {
		t.Fatal("ntrip error switch")
	}
	_ = r.m.set("ntrip", "ok")
	r.cmd("gateway", "n2", "ntrip_clear")
	r.wantAck("gateway", "n2", "done", "")
	r.advance(time.Second)
	if r.gwState()["ntrip"] != "off" {
		t.Fatalf("ntrip after clear: %v", r.gwState()["ntrip"])
	}
	for id, params := range map[string][]string{
		"b1": {`"port":2101,"mountpoint":"M","user":"u","password":"p"`},
		"b2": {`"host":"h","port":"x","mountpoint":"M","user":"u","password":"p"`},
		"b3": {`"host":"h","port":0,"mountpoint":"M","user":"u","password":"p"`},
		"b4": {`"host":"h","port":2101,"user":"u","password":"p"`},
	} {
		r.cmd("gateway", id, "ntrip_set", params...)
		r.wantAck("gateway", id, "failed", "bad_request")
	}
	// Without a position from the autopilot the client waits.
	r = newRig(t).online()
	_ = r.m.set("fix", "none")
	r.cmd("gateway", "n3", "ntrip_set", `"host":"h","port":1`, `"mountpoint":"M","user":"u","password":"p"`)
	r.advance(4 * time.Second)
	if r.gwState()["ntrip"] != "waiting" {
		t.Fatalf("ntrip %v", r.gwState()["ntrip"])
	}
}

// ---- data usage -------------------------------------------------------------------------

func TestUsageCountsWholePackets(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	seq := 0
	r.driveFor(&seq, 5*time.Second, 0.3, 0)
	// What the gateway counts for a topic is the sum of the MQTT packets.
	for _, topic := range []string{"autopilot/telemetry", "autopilot/event", "autopilot/state"} {
		var want uint64
		for _, m := range r.out {
			if m.topic == topic {
				want += uint64(mqttPacketSize(testPrefix+"/"+testName+"/"+m.topic, len(m.payload), m.qos))
			}
		}
		got := r.m.gw.value("usage.mqtt.up." + topic)
		if want == 0 || got == nil || got.(uint64) != want {
			t.Errorf("usage.mqtt.up.%s = %v, want %d", topic, got, want)
		}
	}
	// A topic of the server keeps its full name, traffic down is counted too.
	if r.m.gw.value("usage.mqtt.down.mower/status/server") == nil {
		t.Error("no usage for mower/status/server")
	}
	if r.m.gw.value("usage.mqtt.down.autopilot/drive") == nil || r.m.gw.value("usage.mqtt.down.autopilot/cmd") == nil {
		t.Error("no down usage for the autopilot's topics")
	}
	// total is larger than ntrip plus the topics.
	var sum uint64
	for _, u := range r.m.gw.usage {
		sum += u.up
	}
	if total := r.m.gw.value("usage.total.up").(uint64); total <= sum {
		t.Errorf("total up %d is not above the topics' %d", total, sum)
	}
	// A family member appears in telemetry once it has data.
	r.advance(60 * time.Second)
	var last map[string]any
	for _, m := range r.takeJSON("gateway/telemetry") {
		last = m["metrics"].(map[string]any)
	}
	if _, ok := last["usage.mqtt.up.autopilot/telemetry"]; !ok {
		t.Fatalf("no member for the telemetry topic: %v", last)
	}
	if _, ok := last["usage.mqtt.down.autopilot/job/chunk"]; ok {
		t.Fatal("a member without data")
	}
}

func TestGatewayTelemetryPeriod(t *testing.T) {
	r := newRig(t).online()
	r.advance(190 * time.Second)
	msgs := r.takeJSON("gateway/telemetry")
	if len(msgs) < 3 || len(msgs) > 4 {
		t.Fatalf("%d gateway telemetry messages in 192 s, want one per 60 s", len(msgs))
	}
	m := msgs[0]["metrics"].(map[string]any)
	for _, k := range []string{"signal.rssi", "system.cpu", "system.memory.free", "system.nvs.pct", "usage.total.up", "usage.ntrip.down", "link.dropped"} {
		if _, ok := m[k]; !ok {
			t.Errorf("no %s", k)
		}
	}
	r2 := newRig(t, func(c *simConfig) { c.gwPeriod = 5 * time.Second }).online()
	r2.advance(21 * time.Second)
	if n := len(r2.takeJSON("gateway/telemetry")); n < 4 || n > 6 {
		t.Fatalf("%d messages with a 5 s period", n)
	}
	cat := r2.loadCatalogue("gateway")
	if e, _ := cat.find("signal.rssi"); *e.Period != 5 {
		t.Fatalf("the catalogue says period %v", *e.Period)
	}
}

// ---- messages held while MQTT is down ----------------------------------------------------

func TestReliableMessagesHeldWhileCutOff(t *testing.T) {
	r := newRig(t).online()
	r.events()
	_ = r.m.set("link", "down")
	r.cmd("autopilot", "m", "manual_start") // cannot happen for real, but the autopilot state changes
	r.m.ap.mode = "idle"
	_ = r.m.set("fix", "none") // the autopilot raises an event
	r.advance(time.Second)
	_ = r.m.set("fix", "rtk_fixed")
	r.advance(time.Second)
	if len(r.events()) != 0 {
		t.Fatal("events reached the broker while the gateway was cut off")
	}
	n := len(r.out)
	_ = r.m.set("link", "up")
	evs := r.events()
	if len(r.out) == n || len(evs) < 2 {
		t.Fatalf("held events not delivered when MQTT came back: %v", evs)
	}
	if evs[0]["event"] != "fix_lost" || evs[1]["event"] != "fix_regained" {
		t.Fatalf("order: %v", evs)
	}
	// Online first, then the held messages.
	var idxStatus, idxEvent int
	for i, m := range r.out {
		if m.topic == "gateway/status" && string(m.payload) == "online" {
			idxStatus = i
		}
		if m.topic == "autopilot/event" {
			idxEvent = i
		}
	}
	if idxStatus > idxEvent {
		t.Fatal("events before the status")
	}
}

func TestHoldLimits(t *testing.T) {
	r := newRig(t).online()
	_ = r.m.set("link", "down")
	g := r.m.gw
	big := bytes.Repeat([]byte("x"), 3000)
	for i := 0; i < 30; i++ { // 90 KB
		g.relayUp("autopilot/event", 1, false, big)
	}
	if g.heldSize > holdBytes || g.dropped == 0 {
		t.Fatalf("held %d bytes, dropped %d", g.heldSize, g.dropped)
	}
	// QoS 0 is dropped at once.
	n := len(g.held)
	g.relayUp("autopilot/telemetry", 0, false, big)
	if len(g.held) != n {
		t.Fatal("QoS 0 was held")
	}
	// Older than 60 s: dropped.
	r.advance(61 * time.Second)
	g.relayUp("autopilot/event", 1, false, []byte("{}"))
	if len(g.held) != 1 {
		t.Fatalf("%d held after 61 s", len(g.held))
	}
}

// ---- firmware update (§6.5) --------------------------------------------------------------

func fwImage(version string, size int) []byte {
	b := bytes.Repeat([]byte{0x5A}, size)
	b[0] = 0xE9
	binary.LittleEndian.PutUint32(b[0x20:], 0xABCD5432)
	copy(b[0x30:], append([]byte(version), 0))
	return b
}

func TestGatewayOTA(t *testing.T) {
	r := newRig(t).online()
	img := fwImage("0.4.0", 100000) // 25 chunks
	r.files["gw-fw/0.4.0.bin"] = img
	r.cmd("gateway", "o1", "ota", `"version":"0.4.0"`, `"size":100000`)
	a := r.wantAck("gateway", "o1", "accepted", "")
	if a["ok"] != true {
		t.Fatal(a)
	}
	if r.served["gw-fw"] != 1 {
		t.Fatalf("requests %d", r.served["gw-fw"])
	}
	// While it runs, every other command is busy, except monitor commands.
	r.cmd("gateway", "o2", "ping")
	r.wantAck("gateway", "o2", "failed", "busy")
	r.cmd("gateway", "o3", "monitor_start", `"session":"m","metrics":["system.cpu"],"rate":1`)
	r.wantAck("gateway", "o3", "done", "")
	r.cmd("gateway", "o4", "restart")
	r.wantAck("gateway", "o4", "failed", "busy")
	r.advance(time.Second)
	if r.served["gw-fw"] != 25 {
		t.Fatalf("requests %d, want one per chunk", r.served["gw-fw"])
	}
	// It restarts into the image; the final ack comes from the new image once it
	// has reached the server.
	if got := statusTexts(r); got[len(got)-1] != "offline" {
		t.Fatalf("status %v", got)
	}
	if len(r.acks("gateway", "o1")) != 1 {
		t.Fatal("the final ack came before the restart")
	}
	r.advance(10 * time.Second)
	acks := r.acks("gateway", "o1")
	if len(acks) != 2 || acks[1]["state"] != "done" {
		t.Fatalf("acks %v", acks)
	}
	res := acks[1]["result"].(map[string]any)
	if res["version"] != "0.4.0" || res["previous"] != "0.0.0-sim" || res["partition"] != "ota_1" {
		t.Fatalf("result %v", res)
	}
	s := r.gwState()
	if s["firmware"] != "0.4.0" || s["previous"] != "0.0.0-sim" || s["partition"] != "ota_1" || s["boot"].(float64) != 2 {
		t.Fatalf("state %v", s)
	}
	// The same version again.
	r.cmd("gateway", "o5", "ota", `"version":"0.4.0"`)
	r.wantAck("gateway", "o5", "failed", "same_version")
	// Not busy any more.
	r.cmd("gateway", "o6", "ping")
	r.wantAck("gateway", "o6", "done", "")
}

func TestOTAErrors(t *testing.T) {
	cases := map[string]struct {
		params []string
		files  map[string][]byte
		drop   int
		signal string
		code   string
	}{
		"same version":  {[]string{`"version":"0.0.0-sim"`}, nil, 0, "", "same_version"},
		"no version":    {[]string{`"size":5`}, nil, 0, "", "bad_request"},
		"bad file name": {[]string{`"version":"1","file":"../x.bin"`}, nil, 0, "", "bad_request"},
		"bad size type": {[]string{`"version":"1","size":"big"`}, nil, 0, "", "bad_request"},
		"low signal":    {[]string{`"version":"1"`}, nil, 0, "-110", "low_signal"},
		"not found":     {[]string{`"version":"1"`}, nil, 0, "", "download_failed"},
		"no answers":    {[]string{`"version":"1"`}, map[string][]byte{"gw-fw/1.bin": fwImage("1", 5000)}, 100, "", "download_failed"},
		"bad size":      {[]string{`"version":"1","size":4999`}, map[string][]byte{"gw-fw/1.bin": fwImage("1", 5000)}, 0, "", "bad_size"},
		"other version": {[]string{`"version":"2"`, `"file":"1.bin"`}, map[string][]byte{"gw-fw/1.bin": fwImage("1", 5000)}, 0, "", "bad_image"},
		"custom file":   {[]string{`"version":"3","file":"build-7.bin"`}, nil, 0, "", "download_failed"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			r := newRig(t).online()
			for k, v := range tc.files {
				r.files[k] = v
			}
			r.drop["gw-fw"] = tc.drop
			if tc.signal != "" {
				_ = r.m.set("signal", tc.signal)
			}
			r.cmd("gateway", "o", "ota", tc.params...)
			r.advance(70 * time.Second)
			a := r.ack("gateway", "o")
			if a["state"] != "failed" || a["error"] != tc.code {
				t.Fatalf("%v, want %s", a, tc.code)
			}
			// Nothing changed and it is not busy.
			r.cmd("gateway", "p", "ping")
			r.wantAck("gateway", "p", "done", "")
			if r.m.gw.version != "0.0.0-sim" {
				t.Fatal("version changed")
			}
		})
	}
}

func TestOTARolledBack(t *testing.T) {
	r := newRig(t).online()
	r.files["gw-fw/0.5.0.bin"] = fwImage("0.5.0", 5000)
	_ = r.m.set("ota-rollback", "on")
	r.cmd("gateway", "o", "ota", `"version":"0.5.0"`)
	r.advance(25 * time.Second)
	acks := r.acks("gateway", "o")
	if len(acks) != 2 || acks[1]["error"] != "rolled_back" || acks[1]["state"] != "failed" {
		t.Fatalf("%v", acks)
	}
	if s := r.gwState(); s["firmware"] != "0.0.0-sim" || s["partition"] != "ota_0" || s["boot"].(float64) != 3 {
		t.Fatalf("the old image should run again: %v", s)
	}
}

func TestAutopilotOTA(t *testing.T) {
	r := newRig(t).online()
	img := fwImage("0.2.0", 5000)
	r.files["ap-fw/0.2.0.bin"] = img
	r.cmd("autopilot", "o", "ota", `"version":"0.2.0"`, `"size":5000`)
	r.wantAck("autopilot", "o", "accepted", "")
	r.cmd("autopilot", "p", "manual_start")
	r.wantAck("autopilot", "p", "failed", "busy")
	r.advance(15 * time.Second)
	acks := r.acks("autopilot", "o")
	if len(acks) != 2 || acks[1]["state"] != "done" {
		t.Fatalf("%v", acks)
	}
	if res := acks[1]["result"].(map[string]any); res["version"] != "0.2.0" || res["partition"] != "ota_1" {
		t.Fatalf("%v", res)
	}
	s := r.apState()
	if s["firmware"] != "0.2.0" || s["previous"] != "0.0.0-sim" || s["boot"].(float64) != 2 {
		t.Fatalf("%v", s)
	}
	// The gateway did not restart.
	if r.gwState()["boot"].(float64) != 1 {
		t.Fatal("gateway restarted")
	}
	// stop cancels an update before the restart.
	r.files["ap-fw/0.3.0.bin"] = fwImage("0.3.0", 9000)
	r.drop["ap-fw"] = 1
	r.cmd("autopilot", "o2", "ota", `"version":"0.3.0"`)
	r.advance(time.Second)
	r.cmd("autopilot", "st", "stop")
	r.wantAck("autopilot", "o2", "failed", "cancelled")
	r.wantAck("autopilot", "st", "done", "")
	r.cmd("autopilot", "p2", "manual_start")
	r.wantAck("autopilot", "p2", "done", "")
	// ota is allowed in idle only.
	r.cmd("autopilot", "o3", "ota", `"version":"0.9.0"`)
	r.wantAck("autopilot", "o3", "failed", "wrong_mode")
}

func TestBootCounterSurvivesRestarts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	r1 := newRig(t, func(c *simConfig) { c.statePath = path })
	if r1.m.gw.st.Boot != 1 || r1.m.ap.st.Boot != 1 {
		t.Fatal("first boot")
	}
	r2 := newRig(t, func(c *simConfig) { c.statePath = path })
	if r2.m.gw.st.Boot != 2 || r2.m.ap.st.Boot != 2 {
		t.Fatalf("boot after restarting devsim: %d %d", r2.m.gw.st.Boot, r2.m.ap.st.Boot)
	}
	r2.m.setMQTT(true)
	r2.serverStatus("online")
	r2.advance(2 * time.Second)
	if r2.apState()["boot"].(float64) != 2 {
		t.Fatal("state does not show the new boot")
	}
	var raw storeFile
	b, _ := os.ReadFile(path)
	if json.Unmarshal(b, &raw) != nil || raw.Gateway.Boot != 2 {
		t.Fatalf("state file: %s", b)
	}
}
