package main

import (
	"encoding/json"
	"strconv"
	"strings"
)

// Metric catalogues (wiki Mower-Protocol §16): an index and one retained
// message per part, each at most 4096 bytes.

type metricDef struct {
	Name        string   `json:"name"`
	Key         string   `json:"key,omitempty"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Unit        string   `json:"unit"`
	Kind        string   `json:"kind"`
	Type        string   `json:"type"`
	Period      float64  `json:"period"`
	Rates       []int    `json:"rates"`
	Chart       bool     `json:"chart"`
	Min         *float64 `json:"min,omitempty"`
	Max         *float64 `json:"max,omitempty"`
	Low         *float64 `json:"low,omitempty"`
	High        *float64 `json:"high,omitempty"`
	Decimals    *int     `json:"decimals,omitempty"`
	Values      []string `json:"values,omitempty"`
}

// def builds an entry; the modifiers below refine it.
func def(name, label, description, unit string, period float64, rates []int, chart bool) metricDef {
	if rates == nil {
		rates = []int{}
	}
	return metricDef{Name: name, Label: label, Description: description, Unit: unit, Kind: "gauge", Type: "number",
		Period: period, Rates: rates, Chart: chart}
}

func (m metricDef) key(k string) metricDef { m.Key = k; return m }
func (m metricDef) counter() metricDef     { m.Kind = "counter"; return m }
func (m metricDef) boolean() metricDef     { m.Type = "bool"; return m }
func (m metricDef) enum(values ...string) metricDef {
	m.Type, m.Values = "enum", values
	return m
}
func (m metricDef) rng(lo, hi float64) metricDef { m.Min, m.Max = &lo, &hi; return m }
func (m metricDef) warnLow(v float64) metricDef  { m.Low = &v; return m }
func (m metricDef) warnHigh(v float64) metricDef { m.High = &v; return m }
func (m metricDef) dec(n int) metricDef          { m.Decimals = &n; return m }

func (m metricDef) group() string {
	g, _, _ := strings.Cut(m.Name, ".")
	return g
}

const maxPart = 3800 // below the 4096-byte limit, with room for the envelope

// catalogue is the serialised form: index first, then the parts.
type catalogue struct {
	revision int
	index    []byte
	parts    []catPart
}

type catPart struct {
	name    string
	payload []byte
}

var groupLabels = map[string]string{
	"position": "Position", "gnss": "GNSS", "path": "Path", "battery": "Battery", "drive": "Drive",
	"blade": "Blade", "system": "System", "link": "Board link", "signal": "Signal", "usage": "Data usage",
}

// buildCatalogue groups the metrics by the first part of their name and splits
// a group that does not fit one message.
func buildCatalogue(defs []metricDef, revision int) catalogue {
	var order []string
	groups := map[string][]metricDef{}
	for _, d := range defs {
		g := d.group()
		if _, ok := groups[g]; !ok {
			order = append(order, g)
		}
		groups[g] = append(groups[g], d)
	}
	c := catalogue{revision: revision}
	var names []string
	for _, g := range order {
		for i, chunk := range splitGroup(g, groups[g], revision) {
			name := g
			if i > 0 {
				name = g + "-" + strconv.Itoa(i+1)
			}
			names = append(names, name)
			c.parts = append(c.parts, catPart{name: name, payload: chunk})
		}
	}
	c.index, _ = json.Marshal(map[string]any{"revision": revision, "parts": names})
	return c
}

func splitGroup(group string, defs []metricDef, revision int) [][]byte {
	label := groupLabels[group]
	if label == "" {
		label = strings.ToUpper(group[:1]) + group[1:]
	}
	var out [][]byte
	var cur []metricDef
	flush := func() {
		if len(cur) == 0 {
			return
		}
		b, _ := json.Marshal(map[string]any{"revision": revision, "label": label, "metrics": cur})
		out = append(out, b)
		cur = nil
	}
	for _, d := range defs {
		next := append(append([]metricDef(nil), cur...), d)
		b, _ := json.Marshal(map[string]any{"revision": revision, "label": label, "metrics": next})
		if len(b) > maxPart && len(cur) > 0 {
			flush()
			next = []metricDef{d}
		}
		cur = next
	}
	flush()
	return out
}

// catalogueIndex looks an entry up by exact name, and by family (the entry
// "usage.mqtt.up.*" covers "usage.mqtt.up.<topic>").
func lookupDef(defs []metricDef, name string) (metricDef, bool) {
	for _, d := range defs {
		if d.Name == name {
			return d, true
		}
		if base, ok := strings.CutSuffix(d.Name, ".*"); ok && strings.HasPrefix(name, base+".") && len(name) > len(base)+1 {
			return d, true
		}
	}
	return metricDef{}, false
}

var (
	fixNames   = []string{"none", "single", "dgps", "rtk_float", "rtk_fixed"}
	monRates   = []int{10, 20, 50, 100}
	gwMonRates = []int{1, 2, 5, 10}
	posRates   = []int{10}
	noRates    []int
)

// autopilotDefs is the autopilot's catalogue (§16.5).
func autopilotDefs() []metricDef {
	return []metricDef{
		def("position.lat", "Latitude", "Latitude of the antenna.", "degrees", 1, posRates, false).key("position.lat").dec(8),
		def("position.lon", "Longitude", "Longitude of the antenna.", "degrees", 1, posRates, false).key("position.lon").dec(8),
		def("position.heading", "Heading", "Direction of travel, clockwise from north; unknown while standing still.", "degrees", 1, posRates, false).key("position.heading").rng(0, 360).dec(1),
		def("position.alt", "Altitude", "Height above the ellipsoid.", "m", 1, posRates, true).dec(2),
		def("position.speed", "Ground speed", "Speed over ground.", "m/s", 1, posRates, true).rng(0, 1).dec(2),
		def("gnss.fix", "RTK fix", "Quality of the position solution.", "", 1, posRates, true).key("gnss.fix").enum(fixNames...),
		def("gnss.sats", "Satellites", "Satellites used in the solution.", "", 1, noRates, true).rng(0, 40).dec(0),
		def("gnss.accuracy", "Position accuracy", "Estimated horizontal accuracy.", "m", 1, posRates, true).dec(3),
		def("gnss.correction_age", "Correction age", "Age of the last correction.", "s", 1, noRates, true).dec(1),
		def("path.point", "Path point", "Number of the last path point reached.", "", 1, noRates, false).key("path.point").dec(0),
		def("path.points", "Path points", "Number of points in the path file.", "", 1, noRates, false).key("path.points").dec(0),
		def("battery.v", "Battery voltage", "Voltage at the battery terminals.", "V", 1, monRates, true).rng(18, 29.4).warnLow(21).dec(2),
		def("battery.a", "Battery current", "Current drawn from the battery.", "A", 1, monRates, true).rng(0, 20).dec(2),
		def("battery.power", "Battery power", "Power drawn from the battery.", "W", 1, monRates, true).rng(0, 400).dec(1),
		def("battery.pct", "Battery level", "Charge left, estimated by the autopilot.", "%", 10, noRates, true).key("battery.level").rng(0, 100).warnLow(20).dec(0),
		def("drive.left.speed", "Left wheel speed", "Speed of the left wheel.", "m/s", 1, monRates, true).dec(2),
		def("drive.right.speed", "Right wheel speed", "Speed of the right wheel.", "m/s", 1, monRates, true).dec(2),
		def("drive.left.rpm", "Left wheel rpm", "Rotation speed of the left wheel.", "rpm", 1, monRates, true).dec(0),
		def("drive.right.rpm", "Right wheel rpm", "Rotation speed of the right wheel.", "rpm", 1, monRates, true).dec(0),
		def("blade.on", "Blade on", "Whether the blade runs.", "", 1, noRates, false).key("blade.on").boolean(),
		def("blade.rpm", "Blade rpm", "Rotation speed of the blade.", "rpm", 1, monRates, true).rng(0, 3200).dec(0),
		def("system.psram.free", "PSRAM free", "Free external memory.", "B", 10, posRates, true).dec(0),
		def("system.psram.pct", "PSRAM used", "Share of the external memory in use.", "%", 10, posRates, true).rng(0, 100).dec(0),
		def("system.cpu", "CPU load", "Processor load.", "%", 10, []int{1}, true).rng(0, 100).warnHigh(90).dec(0),
		def("system.core0", "CPU load, core 0", "Load of the first core.", "%", 10, []int{1}, true).rng(0, 100).dec(0),
		def("system.core1", "CPU load, core 1", "Load of the second core.", "%", 10, []int{1}, true).rng(0, 100).dec(0),
		def("system.memory.free", "Memory free", "Free internal memory.", "B", 10, posRates, true).dec(0),
		def("system.memory.min_free", "Memory low-water mark", "Least free memory since boot.", "B", 10, posRates, true).dec(0),
		def("system.memory.largest", "Largest free block", "Largest free internal block.", "B", 10, posRates, true).dec(0),
		def("system.memory.pct", "Memory used", "Share of the internal memory in use.", "%", 10, posRates, true).rng(0, 100).dec(0),
		def("system.nvs.pct", "Settings area used", "Share of the settings flash in use.", "%", 10, noRates, true).rng(0, 100).dec(0),
		def("system.temperature", "Chip temperature", "Temperature of the chip.", "°C", 10, posRates, true).warnHigh(85).dec(1),
		def("link.crc_errors", "Link CRC errors", "Frames dropped for a bad CRC since boot.", "frames", 10, noRates, true).counter().dec(0),
		def("link.dropped", "Link frames dropped", "Frames dropped after retries since boot.", "frames", 10, noRates, true).counter().dec(0),
	}
}

// gatewayDefs is the gateway's catalogue (§16.5); period is the telemetry
// period in seconds of the slow metrics (60 in the contract).
func gatewayDefs(period float64) []metricDef {
	return []metricDef{
		def("signal.rssi", "Signal strength", "Received signal strength of the mobile network.", "dBm", period, noRates, true).key("signal.strength").rng(-113, -51).warnLow(-95).dec(0),
		def("usage.total.up", "Data sent", "Bytes sent over the mobile connection since boot.", "B", period, gwMonRates, true).counter().dec(0),
		def("usage.total.down", "Data received", "Bytes received over the mobile connection since boot.", "B", period, gwMonRates, true).counter().dec(0),
		def("usage.ntrip.up", "NTRIP sent", "Bytes sent to the correction caster since boot.", "B", period, gwMonRates, true).counter().dec(0),
		def("usage.ntrip.down", "NTRIP received", "Bytes of corrections received since boot.", "B", period, gwMonRates, true).counter().dec(0),
		def("usage.mqtt.up.*", "MQTT sent, by topic", "Bytes sent on one MQTT topic since boot.", "B", period, gwMonRates, true).counter().dec(0),
		def("usage.mqtt.down.*", "MQTT received, by topic", "Bytes received on one MQTT topic since boot.", "B", period, gwMonRates, true).counter().dec(0),
		def("link.crc_errors", "Link CRC errors", "Frames dropped for a bad CRC since boot.", "frames", period, noRates, true).counter().dec(0),
		def("link.dropped", "Link frames dropped", "Frames dropped after retries since boot.", "frames", period, noRates, true).counter().dec(0),
		def("system.cpu", "CPU load", "Processor load.", "%", period, gwMonRates, true).rng(0, 100).warnHigh(90).dec(0),
		def("system.core0", "CPU load, core 0", "Load of the first core.", "%", period, gwMonRates, true).rng(0, 100).dec(0),
		def("system.core1", "CPU load, core 1", "Load of the second core.", "%", period, gwMonRates, true).rng(0, 100).dec(0),
		def("system.memory.free", "Memory free", "Free internal memory.", "B", period, gwMonRates, true).dec(0),
		def("system.memory.min_free", "Memory low-water mark", "Least free memory since boot.", "B", period, gwMonRates, true).dec(0),
		def("system.memory.largest", "Largest free block", "Largest free internal block.", "B", period, gwMonRates, true).dec(0),
		def("system.memory.pct", "Memory used", "Share of the internal memory in use.", "%", period, gwMonRates, true).rng(0, 100).dec(0),
		def("system.nvs.pct", "Settings area used", "Share of the settings flash in use.", "%", period, noRates, true).rng(0, 100).dec(0),
	}
}
