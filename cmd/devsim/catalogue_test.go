package main

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
)

// Catalogue output (§16), checked against the contract's own tables.

type catEntry struct {
	Name, Key, Label, Description string
	Unit                          *string
	Kind, Type                    string
	Period                        *float64
	Rates                         []int
	Chart                         *bool
	Values                        []string
}

type loadedCat struct {
	revision int
	entries  []catEntry
	raw      map[string][]byte
}

// loadCatalogue reads the retained catalogue messages of a board the way the
// server does: the index, then every part it lists, all with its revision.
func (r *rig) loadCatalogue(board string) loadedCat {
	r.t.Helper()
	latest := map[string][]byte{}
	for _, m := range r.out {
		if rest, ok := strings.CutPrefix(m.topic, board+"/metrics/"); ok {
			if !m.retain || m.qos != 1 {
				r.t.Fatalf("%s: catalogue must be retained QoS 1", m.topic)
			}
			if len(m.payload) > 4096 {
				r.t.Fatalf("%s is %d bytes", m.topic, len(m.payload))
			}
			latest[rest] = m.payload
		}
	}
	var idx struct {
		Revision int
		Parts    []string
	}
	if err := json.Unmarshal(latest["index"], &idx); err != nil || len(idx.Parts) == 0 {
		r.t.Fatalf("%s index: %v %s", board, err, latest["index"])
	}
	c := loadedCat{revision: idx.Revision, raw: latest}
	partRe := regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)
	for _, p := range idx.Parts {
		if !partRe.MatchString(p) {
			r.t.Fatalf("part name %q", p)
		}
		var part struct {
			Revision int
			Label    string
			Metrics  []catEntry
		}
		if err := json.Unmarshal(latest[p], &part); err != nil {
			r.t.Fatalf("part %s: %v", p, err)
		}
		if part.Revision != idx.Revision || part.Label == "" {
			r.t.Fatalf("part %s: revision %d (index %d), label %q", p, part.Revision, idx.Revision, part.Label)
		}
		base, _, _ := strings.Cut(p, "-")
		for _, e := range part.Metrics {
			if g, _, _ := strings.Cut(e.Name, "."); g != base {
				r.t.Fatalf("metric %s in part %s", e.Name, p)
			}
		}
		c.entries = append(c.entries, part.Metrics...)
	}
	return c
}

func (c loadedCat) find(name string) (catEntry, bool) {
	for _, e := range c.entries {
		if e.Name == name {
			return e, true
		}
	}
	return catEntry{}, false
}

func TestCatalogueEntriesFollowTheContract(t *testing.T) {
	r := newRig(t).online()
	nameRe := regexp.MustCompile(`^[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?$`)
	for _, board := range []string{"gateway", "autopilot"} {
		c := r.loadCatalogue(board)
		seen := map[string]bool{}
		for _, e := range c.entries {
			if !nameRe.MatchString(e.Name) || seen[e.Name] {
				t.Errorf("%s: bad or repeated name %q", board, e.Name)
			}
			seen[e.Name] = true
			switch {
			case e.Label == "" || e.Description == "":
				t.Errorf("%s: no label or description", e.Name)
			case e.Unit == nil || e.Period == nil || e.Rates == nil || e.Chart == nil:
				t.Errorf("%s: a required field is missing (unit, period, rates, chart)", e.Name)
			case e.Kind != "gauge" && e.Kind != "counter":
				t.Errorf("%s: kind %q", e.Name, e.Kind)
			case e.Type != "number" && e.Type != "bool" && e.Type != "enum":
				t.Errorf("%s: type %q", e.Name, e.Type)
			case e.Type == "enum" && len(e.Values) == 0:
				t.Errorf("%s: enum without values", e.Name)
			case e.Kind == "counter" && e.Type != "number":
				t.Errorf("%s: a counter must be a number", e.Name)
			}
		}
	}
}

func TestCatalogueKeysLinkedExactlyOnce(t *testing.T) {
	r := newRig(t).online()
	// §16.4.
	keys := map[string]struct{ typ, unit string }{
		"position.lat": {"number", "degrees"}, "position.lon": {"number", "degrees"},
		"position.heading": {"number", "degrees"}, "gnss.fix": {"enum", ""}, "path.point": {"number", ""}, "path.points": {"number", ""},
		"battery.level": {"number", "%"}, "blade.on": {"bool", ""}, "signal.strength": {"number", "dBm"},
	}
	linked := map[string][]string{}
	var all []catEntry
	for _, board := range []string{"gateway", "autopilot"} {
		for _, e := range r.loadCatalogue(board).entries {
			all = append(all, e)
			if e.Key != "" {
				linked[e.Key] = append(linked[e.Key], board+":"+e.Name)
				k, ok := keys[e.Key]
				if !ok {
					t.Errorf("%s links the unknown key %s", e.Name, e.Key)
					continue
				}
				if e.Type != k.typ || *e.Unit != k.unit {
					t.Errorf("%s: type %s unit %q, key %s wants %s %q", e.Name, e.Type, *e.Unit, e.Key, k.typ, k.unit)
				}
			}
		}
	}
	for k := range keys {
		if len(linked[k]) != 1 {
			t.Errorf("key %s is linked by %v, want exactly one metric", k, linked[k])
		}
	}
	for _, e := range all {
		if e.Key == "gnss.fix" && !slices.Equal(e.Values, []string{"none", "single", "dgps", "rtk_float", "rtk_fixed"}) {
			t.Errorf("gnss.fix values %v", e.Values)
		}
	}
	// Keys that belong together have the same period (§16.4).
	ap := r.loadCatalogue("autopilot")
	var periods []float64
	for _, k := range []string{"position.lat", "position.lon", "position.heading", "gnss.fix"} {
		e, _ := ap.find(k)
		periods = append(periods, *e.Period)
	}
	if slices.Min(periods) != slices.Max(periods) {
		t.Errorf("position keys have periods %v", periods)
	}
}

// TestCatalogueMatchesSection165 checks each row of the contract's table.
func TestCatalogueMatchesSection165(t *testing.T) {
	r := newRig(t).online()
	gw, ap := r.loadCatalogue("gateway"), r.loadCatalogue("autopilot")
	type row struct {
		board, names, key, typ, unit, kind string
		period                             float64
		rates                              []int
		chart                              bool
	}
	none := []int{}
	fast := []int{10, 20, 50, 100}
	rows := []row{
		{"autopilot", "position.lat", "position.lat", "number", "degrees", "gauge", 1, []int{10}, false},
		{"autopilot", "position.lon", "position.lon", "number", "degrees", "gauge", 1, []int{10}, false},
		{"autopilot", "position.heading", "position.heading", "number", "degrees", "gauge", 1, []int{10}, false},
		{"autopilot", "position.alt", "", "number", "m", "gauge", 1, []int{10}, true},
		{"autopilot", "position.speed", "", "number", "m/s", "gauge", 1, []int{10}, true},
		{"autopilot", "gnss.fix", "gnss.fix", "enum", "", "gauge", 1, []int{10}, true},
		{"autopilot", "gnss.sats", "", "number", "", "gauge", 1, none, true},
		{"autopilot", "gnss.accuracy", "", "number", "m", "gauge", 1, []int{10}, true},
		{"autopilot", "gnss.correction_age", "", "number", "s", "gauge", 1, none, true},
		{"autopilot", "path.point", "path.point", "number", "", "gauge", 1, none, false},
		{"autopilot", "path.points", "path.points", "number", "", "gauge", 1, none, false},
		{"autopilot", "battery.v", "", "number", "V", "gauge", 1, fast, true},
		{"autopilot", "battery.a", "", "number", "A", "gauge", 1, fast, true},
		{"autopilot", "battery.power", "", "number", "W", "gauge", 1, fast, true},
		{"autopilot", "battery.pct", "battery.level", "number", "%", "gauge", 10, none, true},
		{"autopilot", "drive.left.speed drive.right.speed", "", "number", "m/s", "gauge", 1, fast, true},
		{"autopilot", "drive.left.rpm drive.right.rpm", "", "number", "rpm", "gauge", 1, fast, true},
		{"autopilot", "blade.on", "blade.on", "bool", "", "gauge", 1, none, false},
		{"autopilot", "blade.rpm", "", "number", "rpm", "gauge", 1, fast, true},
		{"autopilot", "system.psram.free", "", "number", "B", "gauge", 10, []int{10}, true},
		{"autopilot", "system.psram.pct", "", "number", "%", "gauge", 10, []int{10}, true},
		{"gateway", "signal.rssi", "signal.strength", "number", "dBm", "gauge", 60, none, true},
		{"gateway", "usage.total.up usage.total.down usage.ntrip.up usage.ntrip.down usage.mqtt.up.* usage.mqtt.down.*", "", "number", "B", "counter", 60, []int{1, 2, 5, 10}, true},
		{"autopilot", "link.crc_errors link.dropped", "", "number", "frames", "counter", 10, none, true},
		{"gateway", "link.crc_errors link.dropped", "", "number", "frames", "counter", 60, none, true},
		{"autopilot", "system.cpu system.core0 system.core1", "", "number", "%", "gauge", 10, []int{1}, true},
		{"gateway", "system.cpu system.core0 system.core1", "", "number", "%", "gauge", 60, []int{1, 2, 5, 10}, true},
		{"autopilot", "system.memory.free system.memory.min_free system.memory.largest system.memory.pct", "", "number", "", "gauge", 10, []int{10}, true},
		{"gateway", "system.memory.free system.memory.min_free system.memory.largest system.memory.pct", "", "number", "", "gauge", 60, []int{1, 2, 5, 10}, true},
		{"autopilot", "system.nvs.pct", "", "number", "%", "gauge", 10, none, true},
		{"gateway", "system.nvs.pct", "", "number", "%", "gauge", 60, none, true},
		{"autopilot", "system.temperature", "", "number", "°C", "gauge", 10, []int{10}, true},
	}
	for _, rw := range rows {
		cat := ap
		if rw.board == "gateway" {
			cat = gw
		}
		for _, name := range strings.Fields(rw.names) {
			e, ok := cat.find(name)
			if !ok {
				t.Errorf("%s: %s is not in the catalogue", rw.board, name)
				continue
			}
			unit := *e.Unit
			if strings.HasPrefix(name, "system.memory") && !strings.HasSuffix(name, "pct") {
				rw.unit = "B"
			} else if strings.HasPrefix(name, "system.memory") {
				rw.unit = "%"
			}
			if e.Key != rw.key || e.Type != rw.typ || unit != rw.unit || e.Kind != rw.kind ||
				*e.Period != rw.period || !slices.Equal(e.Rates, rw.rates) || *e.Chart != rw.chart {
				t.Errorf("%s %s: key=%q type=%s unit=%q kind=%s period=%v rates=%v chart=%v; the contract says key=%q type=%s unit=%q kind=%s period=%v rates=%v chart=%v",
					rw.board, name, e.Key, e.Type, unit, e.Kind, *e.Period, e.Rates, *e.Chart,
					rw.key, rw.typ, rw.unit, rw.kind, rw.period, rw.rates, rw.chart)
			}
		}
	}
	if _, ok := gw.find("system.temperature"); ok {
		t.Error("the gateway has no temperature sensor")
	}
}

// Every metric that telemetry carries is in the catalogue, and no value is
// missing a catalogue entry.
func TestTelemetryNamesAreInTheCatalogue(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	seq := 0
	r.driveFor(&seq, 70*time.Second, 0.3, 0.1)
	for _, board := range []string{"gateway", "autopilot"} {
		cat := r.loadCatalogue(board)
		defs := cat.entries
		names := map[string]bool{}
		for _, m := range r.takeJSON(board + "/telemetry") {
			if len(m) != 3 || m["time"] == nil || m["boot"] == nil {
				t.Fatalf("telemetry has keys beyond metrics, time and boot: %v", m)
			}
			for n := range m["metrics"].(map[string]any) {
				names[n] = true
			}
		}
		for n := range names {
			var found bool
			for _, e := range defs {
				if e.Name == n || (strings.HasSuffix(e.Name, ".*") && strings.HasPrefix(n, strings.TrimSuffix(e.Name, "*"))) {
					found = true
				}
			}
			if !found {
				t.Errorf("%s telemetry carries %s, which is not in its catalogue", board, n)
			}
		}
		for _, e := range defs {
			if !strings.HasSuffix(e.Name, ".*") && !names[e.Name] && *e.Period > 0 {
				t.Errorf("%s: %s has a period but never appeared in telemetry", board, e.Name)
			}
		}
	}
}

func TestCataloguePublishedWhenLinkComesUp(t *testing.T) {
	r := newRig(t).online()
	n := len(r.msgs("autopilot/metrics/index"))
	m := len(r.msgs("gateway/metrics/index"))
	if n != 1 || m != 1 {
		t.Fatalf("catalogue published %d / %d times", n, m)
	}
	r.serverStatus("offline")
	r.advance(2 * time.Second)
	r.serverStatus("online")
	r.advance(2 * time.Second)
	if len(r.msgs("autopilot/metrics/index")) != 2 || len(r.msgs("gateway/metrics/index")) != 2 {
		t.Fatal("catalogues were not published again when the server link came up")
	}
	if len(r.msgs("autopilot/state")) < 2 || len(r.msgs("gateway/state")) < 2 {
		t.Fatal("state was not published again when the server link came up")
	}
	// Retained and QoS 1: state and status too.
	for _, topic := range []string{"autopilot/state", "gateway/state", "gateway/status"} {
		for _, msg := range r.msgs(topic) {
			if !msg.retain || msg.qos != 1 {
				t.Errorf("%s must be retained QoS 1", topic)
			}
		}
	}
	for _, topic := range []string{"autopilot/telemetry", "gateway/telemetry", "autopilot/monitor"} {
		for _, msg := range r.msgs(topic) {
			if msg.retain || msg.qos != 0 {
				t.Errorf("%s must be QoS 0, not retained", topic)
			}
		}
	}
	for _, topic := range []string{"autopilot/event", "autopilot/cmd/ack", "gateway/cmd/ack", "autopilot/recording"} {
		for _, msg := range r.msgs(topic) {
			if msg.retain || msg.qos != 1 {
				t.Errorf("%s must be QoS 1, not retained", topic)
			}
		}
	}
}

func TestAutopilotTelemetry(t *testing.T) {
	r := newRig(t).online()
	r.takeJSON("autopilot/telemetry")
	// In idle every metric is at least 10 s apart (§7.2).
	r.advance(35 * time.Second)
	msgs := r.takeJSON("autopilot/telemetry")
	if len(msgs) < 3 || len(msgs) > 4 {
		t.Fatalf("%d telemetry messages in 35 s of idle", len(msgs))
	}
	m := msgs[0]["metrics"].(map[string]any)
	// Without a position change the heading is not known: null.
	if v, ok := m["position.heading"]; !ok || v != nil {
		t.Fatalf("heading standing still: %v %v", v, ok)
	}
	if v, ok := m["path.point"]; !ok || v != nil {
		t.Fatalf("path.point outside a path: %v %v", v, ok)
	}
	if m["gnss.fix"].(float64) != 4 || m["position.lat"].(float64) < 54 || m["blade.on"] != false {
		t.Fatalf("metrics: %v", m)
	}

	// Outside idle the 1 s metrics come every second, the 10 s ones less often.
	r.cmd("autopilot", "m", "manual_start")
	r.takeJSON("autopilot/telemetry")
	seq := 0
	r.driveFor(&seq, 21*time.Second, 0.4, 0)
	msgs = r.takeJSON("autopilot/telemetry")
	if len(msgs) < 20 || len(msgs) > 26 {
		t.Fatalf("%d telemetry messages in 21 s of driving", len(msgs))
	}
	slow, withSpeed := 0, 0
	for _, msg := range msgs {
		mm := msg["metrics"].(map[string]any)
		if _, ok := mm["system.cpu"]; ok {
			slow++
		}
		if v, ok := mm["position.speed"]; ok && v.(float64) > 0.2 {
			withSpeed++
			if mm["position.heading"] == nil {
				t.Fatal("heading null while moving")
			}
		}
		if v, ok := mm["battery.v"]; ok && (v.(float64) < 20 || v.(float64) > 29.4) {
			t.Fatalf("battery.v %v", v)
		}
	}
	if slow < 2 || slow > 3 || withSpeed < 15 {
		t.Fatalf("slow metrics in %d messages, moving in %d", slow, withSpeed)
	}
	// position metrics that belong together arrive together.
	for _, msg := range msgs {
		mm := msg["metrics"].(map[string]any)
		_, a := mm["position.lat"]
		_, b := mm["position.lon"]
		_, c := mm["position.heading"]
		_, d := mm["gnss.fix"]
		if a != b || b != c || c != d {
			t.Fatalf("position metrics split over messages: %v", mm)
		}
	}
	// No fix: the position is null.
	_ = r.m.set("fix", "none")
	r.advance(1500 * time.Millisecond)
	msgs = r.takeJSON("autopilot/telemetry")
	last := msgs[len(msgs)-1]["metrics"].(map[string]any)
	if last["position.lat"] != nil || last["gnss.fix"].(float64) != 0 {
		t.Fatalf("no fix: %v", last)
	}
}

func TestAllMessagesFit4096Bytes(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m", "manual_start")
	r.cmd("autopilot", "mon", "monitor_start", `"session":"m","metrics":["battery.v","battery.a","battery.power","blade.rpm"],"rate":100`)
	r.cmd("gateway", "gmon", "monitor_start", `"session":"g","metrics":["usage.total.up","usage.total.down","system.cpu"],"rate":10`)
	seq := 0
	r.driveFor(&seq, 65*time.Second, 0.4, 0.2)
	for _, m := range r.out {
		if strings.HasSuffix(m.topic, "/req") || m.topic == "" {
			continue
		}
		if len(m.payload) > 4096 {
			t.Errorf("%s: %d bytes", m.topic, len(m.payload))
		}
		if !json.Valid(m.payload) && m.topic != "gateway/status" {
			t.Errorf("%s: not JSON: %.60s", m.topic, m.payload)
		}
	}
}

func TestStateMessages(t *testing.T) {
	r := newRig(t).online()
	gw, ap := r.gwState(), r.apState()
	for _, s := range []map[string]any{gw, ap} {
		if s["protocol"] != "0.1" || s["boot"].(float64) != 1 || s["firmware"] != "0.0.0-sim" ||
			s["partition"] != "ota_0" || s["time"] == nil {
			t.Errorf("%v", s)
		}
		if v, ok := s["previous"]; !ok || v != nil {
			t.Errorf("previous: %v %v", v, ok)
		}
	}
	if gw["autopilot_link"] != "up" || gw["ntrip"] != "off" || gw["operator"] == nil {
		t.Errorf("gateway state: %v", gw)
	}
	for _, k := range []string{"mode", "paused", "path", "recording", "fault"} {
		if _, ok := ap[k]; !ok {
			t.Errorf("autopilot state has no %s", k)
		}
	}
	// State changes on transitions only: no new message while nothing changes.
	n := len(r.msgs("autopilot/state"))
	r.advance(30 * time.Second)
	if len(r.msgs("autopilot/state")) != n {
		t.Fatal("state republished without a change")
	}
	r.cmd("autopilot", "m", "manual_start")
	r.advance(100 * time.Millisecond)
	if len(r.msgs("autopilot/state")) != n+1 || r.apState()["mode"] != "manual" {
		t.Fatal("no state on a transition")
	}
}
