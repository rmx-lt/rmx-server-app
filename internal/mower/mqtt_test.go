package mower

import (
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
)

func TestParseSuffix(t *testing.T) {
	cases := []struct {
		suffix string
		board  api.Board
		kind   topicKind
		part   string
	}{
		{"gateway/status", api.BoardGateway, topicStatus, ""},
		{"gateway/state", api.BoardGateway, topicState, ""},
		{"gateway/telemetry", api.BoardGateway, topicTelemetry, ""},
		{"gateway/metrics/index", api.BoardGateway, topicMetrics, "index"},
		{"gateway/metrics/usage", api.BoardGateway, topicMetrics, "usage"},
		{"autopilot/state", api.BoardAutopilot, topicState, ""},
		{"autopilot/telemetry", api.BoardAutopilot, topicTelemetry, ""},
		{"autopilot/event", api.BoardAutopilot, topicEvent, ""},
		{"autopilot/metrics/battery", api.BoardAutopilot, topicMetrics, "battery"},
		{"gateway/cmd/ack", api.BoardGateway, topicAck, ""},
		{"autopilot/cmd/ack", api.BoardAutopilot, topicAck, ""},
		{"gateway/monitor", api.BoardGateway, topicMonitor, ""},
		{"autopilot/monitor", api.BoardAutopilot, topicMonitor, ""},
		// Not handled here: commands go down, chunk transfer has its own handlers.
		{"gateway/cmd", api.BoardGateway, topicOther, ""},
		{"gateway/fw/req", api.BoardGateway, topicOther, ""},
		{"autopilot/drive", api.BoardAutopilot, topicOther, ""},
		{"autopilot/path/chunk", api.BoardAutopilot, topicOther, ""},
		// Wrong board for the topic, bad part names, other roots.
		{"autopilot/status", api.BoardAutopilot, topicOther, ""},
		{"gateway/event", api.BoardGateway, topicOther, ""},
		{"gateway/metrics/Bad", api.BoardGateway, topicOther, ""},
		{"gateway/metrics/a/b", api.BoardGateway, topicOther, ""},
		{"gateway/metrics/", api.BoardGateway, topicOther, ""},
		{"fw/req", "", topicOther, ""},
		{"gateway", "", topicOther, ""},
	}
	for _, c := range cases {
		board, kind, part := parseSuffix(c.suffix)
		if kind != c.kind || part != c.part || (kind != topicOther && board != c.board) {
			t.Errorf("%s: got %q %d %q", c.suffix, board, kind, part)
		}
	}
}

func TestParseTelemetry(t *testing.T) {
	tel, err := ParseTelemetry([]byte(`{
	  "time": 1794650000.25, "boot": 57,
	  "metrics": { "position.lat": 54.68712345, "gnss.fix": 4, "blade.on": true, "path.point": null,
	               "drive.left.rpm": 52, "usage.mqtt.up.autopilot/telemetry": 1480000, "bad": "text", "worse": [1] }
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if tel.Boot != 57 || tel.Time == nil || tel.Time.UnixNano() != 1794650000_250000000 || tel.Skipped != 2 {
		t.Fatalf("%+v", tel)
	}
	got := map[string]*float64{}
	var order []string
	for _, r := range tel.Readings {
		got[r.Metric] = r.Value
		order = append(order, r.Metric)
	}
	if !slices.IsSorted(order) || len(got) != 6 {
		t.Fatalf("%v", order)
	}
	if *got["position.lat"] != 54.68712345 || *got["gnss.fix"] != 4 || *got["blade.on"] != 1 || *got["usage.mqtt.up.autopilot/telemetry"] != 1480000 {
		t.Fatalf("%v", got)
	}
	if v, ok := got["path.point"]; !ok || v != nil {
		t.Fatal("a null value must stay null, not disappear")
	}
}

func TestParseTelemetryShape(t *testing.T) {
	// A board without a clock sends time: null; the time may also be absent.
	for _, p := range []string{`{"time": null, "boot": 1, "metrics": {}}`, `{"boot": 1, "metrics": {"a": 1}}`} {
		tel, err := ParseTelemetry([]byte(p))
		if err != nil || tel.Time != nil {
			t.Fatalf("%s: %+v %v", p, tel, err)
		}
	}
	for name, p := range map[string]string{
		"no boot":       `{"time": 1, "metrics": {}}`,
		"fractional":    `{"time": 1, "boot": 1.5, "metrics": {}}`,
		"negative boot": `{"time": 1, "boot": -1, "metrics": {}}`,
		"no metrics":    `{"time": 1, "boot": 1}`,
		"metrics array": `{"time": 1, "boot": 1, "metrics": []}`,
		"string time":   `{"time": "now", "boot": 1, "metrics": {}}`,
		"negative time": `{"time": -5, "boot": 1, "metrics": {}}`,
		"not json":      `nope`,
		"array":         `[]`,
	} {
		if _, err := ParseTelemetry([]byte(p)); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestStoredTime(t *testing.T) {
	arrived := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { v := arrived.Add(d); return &v }
	if got := StoredTime(nil, arrived); !got.Equal(arrived) {
		t.Fatal("no clock: arrival time")
	}
	if got := StoredTime(at(-time.Minute), arrived); !got.Equal(*at(-time.Minute)) {
		t.Fatal("the board's time is kept")
	}
	for _, d := range []time.Duration{-48 * time.Hour, 48 * time.Hour} {
		if got := StoredTime(at(d), arrived); !got.Equal(arrived) {
			t.Fatalf("an absurd time %v is replaced", d)
		}
	}
}

func TestParseEventKeepsBootAndSeqForDeduplication(t *testing.T) {
	e, err := ParseEvent([]byte(`{ "time": 1794650020.03, "boot": 57, "seq": 14, "event": "fault", "code": "motor_stall", "message": "Left wheel does not turn" }`))
	if err != nil {
		t.Fatal(err)
	}
	if e.Boot != 57 || e.Seq != 14 || e.Name != "fault" || e.Time == nil {
		t.Fatalf("%+v", e)
	}
	var data map[string]any
	if err := json.Unmarshal(e.Data, &data); err != nil || len(data) != 2 || data["code"] != "motor_stall" {
		t.Fatalf("%s %v", e.Data, err)
	}
	// No extra fields: data is an empty object, not null.
	e, err = ParseEvent([]byte(`{"time": null, "boot": 0, "seq": 0, "event": "fault_cleared"}`))
	if err != nil || string(e.Data) != "{}" || e.Time != nil {
		t.Fatalf("%+v %v", e, err)
	}
	for name, p := range map[string]string{
		"no seq":       `{"time": 1, "boot": 1, "event": "boot"}`,
		"no boot":      `{"time": 1, "seq": 1, "event": "boot"}`,
		"no time":      `{"boot": 1, "seq": 1, "event": "boot"}`,
		"no event":     `{"time": 1, "boot": 1, "seq": 1}`,
		"empty event":  `{"time": 1, "boot": 1, "seq": 1, "event": ""}`,
		"event number": `{"time": 1, "boot": 1, "seq": 1, "event": 3}`,
		"seq text":     `{"time": 1, "boot": 1, "seq": "1", "event": "boot"}`,
		"negative":     `{"time": 1, "boot": 1, "seq": -1, "event": "boot"}`,
		"fraction":     `{"time": 1, "boot": 1, "seq": 1.5, "event": "boot"}`,
	} {
		if _, err := ParseEvent([]byte(p)); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestCounterRates(t *testing.T) {
	t0 := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	s := func(sec float64, boot int64, v float64) Sample {
		return Sample{Time: t0.Add(time.Duration(sec * float64(time.Second))), Boot: boot, Value: v}
	}
	rates := CounterRates([]Sample{
		s(0, 7, 1000),
		s(60, 7, 4000),  // 3000 bytes in 60 s
		s(120, 7, 4000), // unchanged: rate 0
		s(180, 8, 500),  // new boot: the counter started again from 0, no rate for the first sample
		s(240, 8, 1100), // 600 bytes in 60 s
		s(240, 8, 1200), // same time: no rate
		s(250, 8, 1000), // went down within a boot: no rate
	})
	want := []float64{50, 0, 10}
	if len(rates) != len(want) {
		t.Fatalf("%+v", rates)
	}
	for i, r := range rates {
		if r.Value != want[i] {
			t.Errorf("rate %d: %v, want %v", i, r.Value, want[i])
		}
	}
	if rates[2].Boot != 8 || !rates[2].Time.Equal(s(240, 8, 0).Time) {
		t.Fatalf("%+v", rates[2])
	}
	if got := CounterRates(nil); len(got) != 0 || got == nil {
		t.Fatal("empty input gives an empty list")
	}
}

func TestParseState(t *testing.T) {
	st, err := ParseState([]byte(`{"protocol": "0.1", "boot": 57, "firmware": "0.1.0", "mode": "path", "paused": null, "time": 1794650000.00}`))
	if err != nil || st.Boot == nil || *st.Boot != 57 || st.Protocol != "0.1" || st.Mode != "path" {
		t.Fatalf("%+v %v", st, err)
	}
	st, err = ParseState([]byte(`{"protocol": "0.1", "boot": 212, "autopilot_link": "up", "future_field": {"a": 1}}`))
	if err != nil || st.AutopilotLink != "up" {
		t.Fatalf("%+v %v", st, err)
	}
	if st, err = ParseState([]byte(`{}`)); err != nil || st.Boot != nil {
		t.Fatalf("%+v %v", st, err)
	}
	for _, bad := range []string{`"x"`, `[]`, `{"boot": "7"}`, `{"boot": 1.5}`, ``} {
		if _, err := ParseState([]byte(bad)); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestParseStatus(t *testing.T) {
	for in, want := range map[string]string{"online": "online", "offline\n": "offline", " online ": "online"} {
		if got, err := ParseStatus([]byte(in)); err != nil || got != want {
			t.Errorf("%q: %q %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "ONLINE", "up", `{"a":1}`} {
		if _, err := ParseStatus([]byte(bad)); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestAutopilotStateIsStaleUnlessTheGatewayIsOnlineAndLinked(t *testing.T) {
	cases := []struct {
		status, link string
		stale        bool
	}{
		{"online", "up", false},
		{"offline", "up", true},
		{"online", "down", true},
		{"online", "incompatible", true},
		{"online", "", true}, // no gateway state yet
		{"", "up", true},     // no status yet
	}
	for _, c := range cases {
		if got := AutopilotStale(c.status, c.link); got != c.stale {
			t.Errorf("%+v: %v", c, got)
		}
	}
}

func TestProtocolSupported(t *testing.T) {
	for v, want := range map[string]bool{
		"0.1": true, "0.2": false, "0.0": false, "1.0": false, "1.1": false,
		"": false, "0": false, "x.y": false, "0.1.2": false, "-1.1": false,
	} {
		if got := ProtocolSupported(v); got != want {
			t.Errorf("%q: %v", v, got)
		}
	}
}
