//go:build integration

// The mower domain: a simulated gateway publishes state, metric catalogues,
// telemetry and events as wiki Mower-Protocol defines them, and the API shows
// what the server stored.

package integration

import (
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
)

// sim is a simulated mower: the gateway publishes both boards' topics (the
// gateway passes autopilot payloads through, wiki Mower-Protocol §3).
type sim struct {
	t   *testing.T
	app *testApp
	dev *mqttDevice
}

func (a *testApp) sim() *sim { return &sim{t: a.t, app: a, dev: a.mqttConnect()} }

func (s *sim) name() string { return s.dev.id }

func (s *sim) pub(suffix, payload string) { s.dev.publish(s.dev.topic(suffix), []byte(payload)) }

// metricJSON is one catalogue entry.
func metricJSON(name, key, typ, kind, unit string) string {
	k := ""
	if key != "" {
		k = fmt.Sprintf(`"key": %q, `, key)
	}
	values := ""
	if typ == "enum" {
		values = `, "values": ["none", "single", "dgps", "rtk_float", "rtk_fixed"]`
	}
	return fmt.Sprintf(`{"name": %q, %s"label": %q, "description": "d", "unit": %q, "kind": %q, "type": %q, "period": 1, "rates": [], "chart": true%s}`,
		name, k, name, unit, kind, typ, values)
}

func partJSON(rev int, label string, metrics ...string) string {
	return fmt.Sprintf(`{"revision": %d, "label": %q, "metrics": [%s]}`, rev, label, strings.Join(metrics, ","))
}

func indexJSON(rev int, parts ...string) string {
	quoted := make([]string, len(parts))
	for i, p := range parts {
		quoted[i] = fmt.Sprintf("%q", p)
	}
	return fmt.Sprintf(`{"revision": %d, "parts": [%s]}`, rev, strings.Join(quoted, ","))
}

func (a *testApp) device(name string) api.DeviceDetail {
	a.t.Helper()
	status, _, body := a.req(a.http, "GET", "/api/devices/"+name, nil)
	eq(a.t, status, 200)
	return decode[api.DeviceDetail](a.t, body)
}

// eventually polls until cond holds (the server handles MQTT messages in the background).
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(wait)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("not in time: %s", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func (a *testApp) waitDevice(name, what string, cond func(api.DeviceDetail) bool) api.DeviceDetail {
	a.t.Helper()
	var d api.DeviceDetail
	eventually(a.t, what, func() bool {
		status, _, body := a.req(a.http, "GET", "/api/devices/"+name, nil)
		if status != 200 {
			return false
		}
		d = decode[api.DeviceDetail](a.t, body)
		return cond(d)
	})
	return d
}

func (a *testApp) history(name, board, metric string, extra ...string) api.MetricHistory {
	a.t.Helper()
	q := url.Values{"board": {board}, "metric": {metric}}
	for i := 0; i+1 < len(extra); i += 2 {
		q.Set(extra[i], extra[i+1])
	}
	status, _, body := a.req(a.http, "GET", "/api/devices/"+name+"/history?"+q.Encode(), nil)
	eq(a.t, status, 200)
	return decode[api.MetricHistory](a.t, body)
}

// hasState reports whether a board's state was received: through JSON, a missing state is null.
func hasState(raw json.RawMessage) bool { return len(raw) > 0 && string(raw) != "null" }

func keyOf(d api.DeviceDetail, key string) api.KeyStatus {
	for _, k := range d.Keys {
		if k.Key == key {
			return k
		}
	}
	panic("no key " + key)
}

func catalogueOf(d api.DeviceDetail, board api.Board) api.BoardCatalogue {
	for _, c := range d.Catalogues {
		if c.Board == board {
			return c
		}
	}
	panic("no catalogue for " + string(board))
}

func TestMowerIngestEndToEnd(t *testing.T) {
	app := startApp(t, newDatabase(t))
	if s := app.status(app.anon, "GET", "/api/devices", nil); s != 401 {
		t.Fatalf("devices without a session: %d", s)
	}
	if s, _, _ := app.req(app.http, "GET", "/api/devices", nil); s != 200 {
		t.Fatalf("empty list: %d", s)
	}
	m := app.sim()
	name := m.name()

	// The browser listens on the WebSocket for what the server pushes.
	socket := app.ws()

	// Gateway: status (retained in production), state, catalogue.
	m.pub("gateway/status", "online")
	m.pub("gateway/state", `{"protocol": "0.1", "boot": 212, "firmware": "0.4.0", "previous": "0.3.2", "partition": "ota_0",
	  "autopilot_link": "up", "ntrip": "streaming", "operator": "24601", "time": 1794650000}`)
	m.pub("gateway/metrics/index", indexJSON(3, "signal", "usage"))
	m.pub("gateway/metrics/signal", partJSON(3, "Signal", metricJSON("signal.rssi", "signal.strength", "number", "gauge", "dBm")))
	m.pub("gateway/metrics/usage", partJSON(3, "Data usage",
		metricJSON("usage.total.up", "", "number", "counter", "B"),
		metricJSON("usage.mqtt.up.*", "", "number", "counter", "B")))

	// Autopilot: state and a catalogue that leaves three keys unlinked (position.heading, path.point, path.points).
	m.pub("autopilot/state", `{"protocol": "0.1", "boot": 57, "firmware": "0.1.0", "previous": null, "partition": "ota_0",
	  "mode": "idle", "paused": null, "path": null, "recording": null, "fault": null, "time": 1794650000.00}`)
	m.pub("autopilot/metrics/index", indexJSON(12, "position", "battery"))
	m.pub("autopilot/metrics/position", partJSON(12, "Position",
		metricJSON("position.lat", "position.lat", "number", "gauge", "degrees"),
		metricJSON("position.lon", "position.lon", "number", "gauge", "degrees"),
		metricJSON("gnss.fix", "gnss.fix", "enum", "gauge", "")))
	m.pub("autopilot/metrics/battery", partJSON(12, "Battery",
		metricJSON("battery.v", "", "number", "gauge", "V"),
		metricJSON("battery.pct", "battery.level", "number", "gauge", "%"),
		metricJSON("blade.on", "blade.on", "bool", "gauge", "")))

	d := app.waitDevice(name, "state and catalogues", func(d api.DeviceDetail) bool {
		return hasState(d.Autopilot.State) && catalogueOf(d, api.BoardAutopilot).Revision != nil &&
			catalogueOf(d, api.BoardGateway).Revision != nil && d.GatewayStatus != nil
	})
	eq(t, d.Name, name)
	eq(t, *d.GatewayStatus, "online")
	if d.AutopilotStale {
		t.Fatal("autopilot state is stale while the gateway is online and linked")
	}
	var gw, ap map[string]any
	if err := json.Unmarshal(d.Gateway.State, &gw); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(d.Autopilot.State, &ap); err != nil {
		t.Fatal(err)
	}
	eq(t, gw["firmware"], any("0.4.0"))
	eq(t, ap["mode"], any("idle"))
	eq(t, *d.Gateway.Boot, int64(212))
	eq(t, *d.Autopilot.Boot, int64(57))
	eq(t, *d.Gateway.ProtocolSupported, true)

	cat := catalogueOf(d, api.BoardAutopilot)
	eq(t, *cat.Revision, int64(12))
	eq(t, len(cat.Parts), 2)
	eq(t, cat.Parts[0].Name, "position")
	eq(t, cat.Parts[1].Metrics[1].Name, "battery.pct")
	eq(t, *cat.Parts[1].Metrics[1].Key, "battery.level")
	eq(t, len(catalogueOf(d, api.BoardGateway).Parts), 2)

	// Keys: linked across both boards, two reported as missing.
	if k := keyOf(d, "signal.strength"); k.State != api.KeyLinked || *k.Board != api.BoardGateway || *k.Metric != "signal.rssi" {
		t.Fatalf("%+v", k)
	}
	if k := keyOf(d, "battery.level"); k.State != api.KeyLinked || *k.Metric != "battery.pct" {
		t.Fatalf("%+v", k)
	}
	var missing []string
	for _, k := range d.Keys {
		if k.State == api.KeyMissing {
			missing = append(missing, k.Key)
		}
	}
	slices.Sort(missing)
	if !slices.Equal(missing, []string{"path.point", "path.points", "position.heading"}) {
		t.Fatalf("missing keys: %v", missing)
	}

	// Telemetry: gauges, a null value, a bool and a family member; the gateway's counters over two boots.
	base := time.Now().Add(-10 * time.Minute).Unix()
	ap1 := fmt.Sprintf(`{"time": %d.25, "boot": 57, "metrics": {"position.lat": 54.68712345, "position.lon": 25.27965432, "gnss.fix": 4,
	  "battery.v": 25.3, "battery.pct": 78, "blade.on": true, "position.heading": null}}`, base)
	m.pub("autopilot/telemetry", ap1)
	counters := []struct {
		at, boot  int64
		up, topic int
	}{{0, 212, 1000, 100}, {60, 212, 4000, 400}, {120, 212, 7000, 700}, {180, 213, 500, 50}, {240, 213, 1100, 110}}
	for _, c := range counters {
		m.pub("gateway/telemetry", fmt.Sprintf(`{"time": %d, "boot": %d, "metrics": {"signal.rssi": -71, "usage.total.up": %d, "usage.mqtt.up.autopilot/telemetry": %d}}`,
			base+c.at, c.boot, c.up, c.topic))
	}

	d = app.waitDevice(name, "latest values", func(d api.DeviceDetail) bool {
		for _, l := range d.Latest {
			if l.Board == api.BoardGateway && l.Metric == "usage.total.up" && l.Value != nil && *l.Value == 1100 {
				return true
			}
		}
		return false
	})
	latest := map[string]api.LatestValue{}
	for _, l := range d.Latest {
		latest[string(l.Board)+":"+l.Metric] = l
	}
	eq(t, *latest["autopilot:battery.v"].Value, 25.3)
	eq(t, *latest["autopilot:blade.on"].Value, 1.0)
	eq(t, *latest["autopilot:gnss.fix"].Value, 4.0)
	if v, ok := latest["autopilot:position.heading"]; !ok || v.Value != nil {
		t.Fatalf("a null value is the latest value, shown as unknown: %+v", v)
	}
	eq(t, latest["gateway:usage.total.up"].Boot, int64(213))
	// The gateway restarted: the server noticed the new boot.
	eq(t, *d.Gateway.Boot, int64(213))

	// History: a gauge as stored, the null left out.
	h := app.history(name, "autopilot", "battery.v")
	eq(t, h.MetricKind, "gauge")
	eq(t, h.Rate, false)
	eq(t, len(h.Points), 1)
	eq(t, h.Points[0].Value, 25.3)
	eq(t, h.Points[0].Time.UnixMilli(), base*1000+250)
	if h := app.history(name, "autopilot", "position.heading"); len(h.Points) != 0 || h.Points == nil {
		t.Fatalf("%+v", h)
	}
	// A counter as a rate, per second, with no rate across the restart.
	h = app.history(name, "gateway", "usage.total.up")
	eq(t, h.MetricKind, "counter")
	eq(t, h.Rate, true)
	var rates []float64
	for _, p := range h.Points {
		rates = append(rates, p.Value)
	}
	if !slices.Equal(rates, []float64{50, 50, 10}) {
		t.Fatalf("rates %v", rates)
	}
	eq(t, h.Points[2].Boot, int64(213))
	// ... a family member through its family's entry, and the stored counts on request.
	h = app.history(name, "gateway", "usage.mqtt.up.autopilot/telemetry")
	eq(t, h.MetricKind, "counter")
	eq(t, len(h.Points), 3)
	h = app.history(name, "gateway", "usage.total.up", "rate", "false")
	eq(t, len(h.Points), 5)
	eq(t, h.Points[3].Value, 500.0)
	// Limit keeps the newest and says so.
	h = app.history(name, "gateway", "usage.total.up", "rate", "false", "limit", "2")
	eq(t, h.Truncated, true)
	eq(t, len(h.Points), 2)
	eq(t, h.Points[1].Value, 1100.0)
	eq(t, app.status(app.http, "GET", "/api/devices/"+name+"/history?board=gateway", nil), 400)
	eq(t, app.status(app.http, "GET", "/api/devices/"+name+"/history?board=nope&metric=x", nil), 400)
	eq(t, app.status(app.http, "GET", "/api/devices/unknown-device/history?board=gateway&metric=x", nil), 404)

	// Events: one of each, and the list shows them.
	m.pub("autopilot/event", `{"time": 1794650020.03, "boot": 57, "seq": 14, "event": "fault", "code": "motor_stall", "message": "Left wheel does not turn"}`)
	eventually(t, "the event", func() bool {
		return count(t, app.pool, "device_events") == 1
	})
	status, _, body := app.req(app.http, "GET", "/api/devices/"+name+"/events", nil)
	eq(t, status, 200)
	events := decode[api.DeviceEventList](t, body).Events
	eq(t, len(events), 1)
	eq(t, events[0].Event, "fault")
	eq(t, events[0].Seq, int64(14))
	var data map[string]any
	if err := json.Unmarshal(events[0].Data, &data); err != nil || data["code"] != "motor_stall" {
		t.Fatalf("%s %v", events[0].Data, err)
	}

	// The device list.
	status, _, body = app.req(app.http, "GET", "/api/devices", nil)
	eq(t, status, 200)
	list := decode[api.DeviceList](t, body).Devices
	eq(t, len(list), 1)
	eq(t, list[0].Name, name)
	eq(t, *list[0].AutopilotMode, "idle")
	eq(t, list[0].AutopilotStale, false)

	// The same through the WebSocket: requests ...
	socket.send("r1", api.RequestDevices{})
	devices, ok := rpcData(t, socket.nextResponse("r1")).(api.DeviceList)
	if !ok || len(devices.Devices) != 1 {
		t.Fatalf("%+v", devices)
	}
	socket.send("r2", api.RequestDevice{Name: name})
	detail, ok := rpcData(t, socket.nextResponse("r2")).(api.DeviceDetail)
	if !ok || detail.Name != name || len(detail.Keys) != len(d.Keys) {
		t.Fatalf("%+v", detail)
	}
	socket.send("r3", api.RequestMetricHistory{Device: name, Board: api.BoardGateway, Metric: "usage.total.up"})
	hist, ok := rpcData(t, socket.nextResponse("r3")).(api.MetricHistory)
	if !ok || len(hist.Points) != 3 {
		t.Fatalf("%+v", hist)
	}
	socket.send("r4", api.RequestDevice{Name: "nobody"})
	if r := socket.nextResponse("r4"); !isError(r) {
		t.Fatalf("%+v", r)
	}

	// ... and the pushes: a change notice and the live telemetry of the next message.
	m.pub("gateway/status", "offline")
	m.pub("autopilot/telemetry", fmt.Sprintf(`{"time": %d, "boot": 57, "metrics": {"battery.v": 25.1}}`, time.Now().Unix()))
	var sawTelemetry, sawChange bool
	for i := 0; i < 200 && !(sawTelemetry && sawChange); i++ {
		switch msg := socket.next().V.(type) {
		case api.MsgTelemetry:
			if msg.Device == name && msg.Board == api.BoardAutopilot && len(msg.Values) == 1 && *msg.Values[0].Value == 25.1 {
				sawTelemetry = true
			}
		case api.MsgDeviceChanged:
			sawChange = sawChange || (msg.Device == name && msg.Change == "status" && msg.Board == nil)
		}
	}
	if !sawTelemetry || !sawChange {
		t.Fatalf("pushes: telemetry %v, change %v", sawTelemetry, sawChange)
	}
}

func rpcData(t *testing.T, r api.RpcResult) any {
	t.Helper()
	ok, is := r.V.(api.RpcOk)
	if !is {
		t.Fatalf("%+v", r)
	}
	return ok.Data.V
}

// nextResponse is the next response to requestID; pushed messages before it are skipped.
func (w *ws) nextResponse(requestID string) api.RpcResult {
	w.t.Helper()
	for i := 0; i < 500; i++ {
		if m, ok := w.next().V.(api.MsgResponse); ok {
			eq(w.t, m.Response.RequestID, requestID)
			return m.Response.Result
		}
	}
	w.t.Fatal("no response")
	return api.RpcResult{}
}

func TestMowerCatalogueIsUsedOnlyWhenComplete(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()
	nums := func(names ...string) []string {
		out := make([]string, len(names))
		for i, n := range names {
			out[i] = metricJSON(n, "", "number", "gauge", "")
		}
		return out
	}

	// Parts before the index, and the index before the last part: not complete, nothing used.
	m.pub("autopilot/metrics/a", partJSON(1, "A", nums("a.x")...))
	m.pub("autopilot/metrics/index", indexJSON(1, "a", "b"))
	d := app.waitDevice(name, "pending catalogue", func(d api.DeviceDetail) bool {
		return slices.Equal(catalogueOf(d, api.BoardAutopilot).MissingParts, []string{"b"})
	})
	c := catalogueOf(d, api.BoardAutopilot)
	if c.Revision != nil || len(c.Parts) != 0 || *c.PendingRevision != 1 || !slices.Equal(c.MissingParts, []string{"b"}) {
		t.Fatalf("%+v", c)
	}
	for _, k := range d.Keys {
		if k.State != api.KeyMissing {
			t.Fatalf("%+v", k)
		}
	}

	m.pub("autopilot/metrics/b", partJSON(1, "B", nums("b.x")...))
	d = app.waitDevice(name, "complete catalogue", func(d api.DeviceDetail) bool { return catalogueOf(d, api.BoardAutopilot).Revision != nil })
	c = catalogueOf(d, api.BoardAutopilot)
	if c.PendingRevision != nil || len(c.MissingParts) != 0 || len(c.Parts) != 2 {
		t.Fatalf("%+v", c)
	}

	// A new revision: the index and one part arrive; the old catalogue stays in use until the rest does.
	m.pub("autopilot/metrics/index", indexJSON(2, "a", "b"))
	m.pub("autopilot/metrics/a", partJSON(2, "A", nums("a.x", "a.y")...))
	d = app.waitDevice(name, "pending revision 2", func(d api.DeviceDetail) bool {
		return slices.Equal(catalogueOf(d, api.BoardAutopilot).MissingParts, []string{"b"})
	})
	c = catalogueOf(d, api.BoardAutopilot)
	if *c.Revision != 1 || *c.PendingRevision != 2 || !slices.Equal(c.MissingParts, []string{"b"}) || len(c.Parts[0].Metrics) != 1 {
		t.Fatalf("%+v", c)
	}
	m.pub("autopilot/metrics/b", partJSON(2, "B", nums("b.x")...))
	d = app.waitDevice(name, "revision 2 in use", func(d api.DeviceDetail) bool {
		r := catalogueOf(d, api.BoardAutopilot).Revision
		return r != nil && *r == 2
	})
	c = catalogueOf(d, api.BoardAutopilot)
	if c.PendingRevision != nil || len(c.Parts[0].Metrics) != 2 {
		t.Fatalf("%+v", c)
	}

	// A key linked twice counts as not linked; one that no metric links is missing.
	dup := func(n string) string { return metricJSON(n, "battery.level", "number", "gauge", "%") }
	m.pub("autopilot/metrics/index", indexJSON(3, "a", "b"))
	m.pub("autopilot/metrics/a", partJSON(3, "A", dup("a.x")))
	m.pub("autopilot/metrics/b", partJSON(3, "B", dup("b.x"), metricJSON("blade.on", "blade.on", "bool", "gauge", "")))
	d = app.waitDevice(name, "revision 3 in use", func(d api.DeviceDetail) bool {
		r := catalogueOf(d, api.BoardAutopilot).Revision
		return r != nil && *r == 3
	})
	if k := keyOf(d, "battery.level"); k.State != api.KeyDuplicate || k.Metric != nil || len(k.Candidates) != 2 {
		t.Fatalf("%+v", k)
	}
	if k := keyOf(d, "blade.on"); k.State != api.KeyLinked {
		t.Fatalf("%+v", k)
	}
	if k := keyOf(d, "path.point"); k.State != api.KeyMissing {
		t.Fatalf("%+v", k)
	}
}

func TestMowerEventsAreDeduplicatedByBootAndSeq(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()
	ev := func(boot, seq int, event string) string {
		return fmt.Sprintf(`{"time": 1794650020.03, "boot": %d, "seq": %d, "event": %q}`, boot, seq, event)
	}
	m.pub("autopilot/event", ev(57, 14, "fault"))
	m.pub("autopilot/event", ev(57, 14, "fault")) // sent again (QoS 1 repeats)
	m.pub("autopilot/event", ev(57, 15, "fault_cleared"))
	m.pub("autopilot/event", ev(58, 14, "boot"))  // same seq, another boot: a different event
	m.pub("autopilot/event", ev(57, 14, "fault")) // a late repeat after the restart
	m.pub("autopilot/event", `{"time": 1, "boot": 58, "event": "no_seq"}`)
	m.pub("autopilot/event", `not json`)
	m.pub("autopilot/state", `{"protocol": "0.1", "boot": 58, "mode": "idle"}`) // processed after the events above
	app.waitDevice(name, "state after the events", func(d api.DeviceDetail) bool { return hasState(d.Autopilot.State) })

	status, _, body := app.req(app.http, "GET", "/api/devices/"+name+"/events", nil)
	eq(t, status, 200)
	events := decode[api.DeviceEventList](t, body).Events
	var got []string
	for _, e := range events {
		got = append(got, fmt.Sprintf("%d/%d %s", e.Boot, e.Seq, e.Event))
	}
	slices.Sort(got)
	if !slices.Equal(got, []string{"57/14 fault", "57/15 fault_cleared", "58/14 boot"}) {
		t.Fatalf("%v", got)
	}
	eq(t, count(t, app.pool, "device_events"), 3)
	// The late repeat of boot 57 did not look like a restart: the board is at boot 58.
	eq(t, *app.device(name).Autopilot.Boot, int64(58))
}

func TestMowerAutopilotStateIsOutOfDateWhileTheGatewayIsNot(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()

	m.pub("gateway/status", "online")
	m.pub("gateway/state", `{"protocol": "0.1", "boot": 1, "autopilot_link": "up"}`)
	m.pub("autopilot/state", `{"protocol": "0.2", "boot": 1, "mode": "path"}`)
	d := app.waitDevice(name, "states", func(d api.DeviceDetail) bool { return hasState(d.Autopilot.State) && hasState(d.Gateway.State) })
	eq(t, d.AutopilotStale, false)
	// A protocol version the server does not support is shown.
	eq(t, *d.Autopilot.ProtocolSupported, false)
	eq(t, *d.Gateway.ProtocolSupported, true)

	m.pub("gateway/state", `{"protocol": "0.1", "boot": 1, "autopilot_link": "down"}`)
	d = app.waitDevice(name, "link down", func(d api.DeviceDetail) bool { return d.AutopilotStale })
	eq(t, hasState(d.Autopilot.State), true) // still shown, marked out of date

	m.pub("gateway/state", `{"protocol": "0.1", "boot": 1, "autopilot_link": "up"}`)
	app.waitDevice(name, "link up", func(d api.DeviceDetail) bool { return !d.AutopilotStale })

	m.pub("gateway/status", "offline")
	d = app.waitDevice(name, "gateway offline", func(d api.DeviceDetail) bool { return d.AutopilotStale })
	eq(t, *d.GatewayStatus, "offline")
}

func TestMowerBadMessagesAreDroppedAndTheServerKeepsGoing(t *testing.T) {
	app := startApp(t, newDatabase(t))
	m := app.sim()
	name := m.name()

	m.pub("gateway/status", "maybe")
	m.pub("gateway/state", `[1,2]`)
	m.pub("gateway/telemetry", `{"boot": 1}`)
	m.pub("gateway/telemetry", `{"time": 1, "metrics": {"a": 1}}`)
	m.pub("gateway/metrics/index", `{"revision": "x"}`)
	m.pub("gateway/metrics/Bad_Part", `{}`)
	m.pub("gateway/metrics/big", `{"revision": 1, "label": "`+strings.Repeat("x", 5000)+`", "metrics": []}`)
	m.pub("gateway/cmd", `{"id": "c1", "cmd": "ping"}`) // not this domain's
	m.pub("gateway/telemetry", `{"boot": 1, "metrics": {"signal.rssi": -60, "text": "x"}}`)
	d := app.waitDevice(name, "the valid telemetry", func(d api.DeviceDetail) bool { return len(d.Latest) > 0 })
	eq(t, len(d.Latest), 1)
	eq(t, d.Latest[0].Metric, "signal.rssi")
	eq(t, d.GatewayStatus == nil, true)
	eq(t, hasState(d.Gateway.State), false)
	eq(t, count(t, app.pool, "catalogue_parts"), 0)
}
