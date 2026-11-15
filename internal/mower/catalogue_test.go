package mower

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/rmx-lt/rmx-server-app/internal/api"
)

// metric builds a catalogue entry (JSON) in the shape of wiki Mower-Protocol §16.1.
func metric(name, key, typ string) string {
	k := ""
	if key != "" {
		k = fmt.Sprintf(`"key": %q,`, key)
	}
	values := ""
	if typ == "enum" {
		values = `, "values": ["none", "single", "dgps", "rtk_float", "rtk_fixed"]`
	}
	return fmt.Sprintf(`{"name": %q, %s "label": "L", "description": "D", "unit": "", "kind": "gauge", "type": %q, "period": 1, "rates": [], "chart": true%s}`,
		name, k, typ, values)
}

func part(rev int, metrics ...string) []byte {
	return []byte(fmt.Sprintf(`{"revision": %d, "label": "Group", "metrics": [%s]}`, rev, strings.Join(metrics, ",")))
}

func mustPart(t *testing.T, payload []byte) Part {
	t.Helper()
	p, err := ParsePart(payload)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestParseIndex(t *testing.T) {
	idx, err := ParseIndex([]byte(`{ "revision": 12, "parts": ["battery", "drive", "system"] }`))
	if err != nil || idx.Revision != 12 || !slices.Equal(idx.Parts, []string{"battery", "drive", "system"}) {
		t.Fatalf("%+v %v", idx, err)
	}
	for name, bad := range map[string]string{
		"no revision":        `{"parts": []}`,
		"fraction":           `{"revision": 1.5, "parts": []}`,
		"negative":           `{"revision": -1, "parts": []}`,
		"no parts":           `{"revision": 1}`,
		"bad part name":      `{"revision": 1, "parts": ["Battery"]}`,
		"part name too long": `{"revision": 1, "parts": ["` + strings.Repeat("a", 33) + `"]}`,
		"listed twice":       `{"revision": 1, "parts": ["a", "a"]}`,
		"lists itself":       `{"revision": 1, "parts": ["index"]}`,
		"not an object":      `[1]`,
		"trailing data":      `{"revision": 1, "parts": []} {}`,
	} {
		if _, err := ParseIndex([]byte(bad)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestParsePartEntries(t *testing.T) {
	p := mustPart(t, []byte(`{
	  "revision": 12, "label": "Battery",
	  "metrics": [
	    { "name": "battery.v", "label": "Battery voltage", "description": "Voltage.", "unit": "V", "kind": "gauge", "type": "number",
	      "period": 1, "rates": [10, 20, 50, 100], "chart": true, "min": 18, "max": 29.4, "low": 21, "decimals": 2, "unknown_field": 1 },
	    { "name": "battery.pct", "key": "battery.level", "label": "Battery level", "description": "Charge.", "unit": "%", "kind": "gauge", "type": "number",
	      "period": 10, "rates": [], "chart": true, "min": 0, "max": 100, "low": 20, "decimals": 0 },
	    { "name": "usage.mqtt.up.*", "key": "ignored.on.family", "label": "Per topic", "description": "D", "unit": "B", "kind": "counter", "type": "number",
	      "period": 60, "rates": [1, 2], "chart": true }
	  ]
	}`))
	if p.Revision != 12 || p.Label != "Battery" || len(p.Metrics) != 3 || len(p.Skipped) != 0 {
		t.Fatalf("%+v", p)
	}
	v := p.Metrics[0]
	if v.Key != nil || v.Unit != "V" || v.Min == nil || *v.Min != 18 || v.Max == nil || *v.Max != 29.4 ||
		v.High != nil || v.Decimals == nil || *v.Decimals != 2 || !slices.Equal(v.Rates, []float64{10, 20, 50, 100}) || v.Values == nil {
		t.Fatalf("%+v", v)
	}
	if k := p.Metrics[1].Key; k == nil || *k != "battery.level" {
		t.Fatalf("key: %v", k)
	}
	// A family cannot answer a key: its members are not known.
	if p.Metrics[2].Key != nil || p.Metrics[2].Kind != "counter" {
		t.Fatalf("%+v", p.Metrics[2])
	}
}

func TestParsePartSkipsInvalidEntriesOnly(t *testing.T) {
	good := metric("battery.v", "", "number")
	p := mustPart(t, part(1,
		good,
		`{"name": "no.label"}`,
		strings.Replace(metric("bad.kind", "", "number"), `"gauge"`, `"meter"`, 1),
		metric("Upper.Case", "", "number"),
		strings.Replace(metric("enum.without.values", "", "number"), `"number"`, `"enum"`, 1),
		good, // the same name twice
		`"not an object"`,
	))
	if len(p.Metrics) != 1 || p.Metrics[0].Name != "battery.v" || len(p.Skipped) != 6 {
		t.Fatalf("%d metrics, skipped %q", len(p.Metrics), p.Skipped)
	}
	for name, bad := range map[string]string{
		"no revision": `{"label": "x", "metrics": []}`,
		"no label":    `{"revision": 1, "metrics": []}`,
		"no metrics":  `{"revision": 1, "label": "x"}`,
	} {
		if _, err := ParsePart([]byte(bad)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestAssembleNeedsIndexAndEveryPartAtItsRevision(t *testing.T) {
	idx := Index{Revision: 12, Parts: []string{"battery", "drive"}}
	battery := mustPart(t, part(12, metric("battery.v", "", "number")))
	drive := mustPart(t, part(12, metric("drive.left.speed", "", "number")))
	oldDrive := mustPart(t, part(11, metric("drive.left.speed", "", "number")))

	// A part is missing.
	if _, missing := Assemble(api.BoardAutopilot, idx, map[string]Part{"battery": battery}); !slices.Equal(missing, []string{"drive"}) {
		t.Fatalf("missing %v", missing)
	}
	// A part has another revision: it counts as missing.
	if _, missing := Assemble(api.BoardAutopilot, idx, map[string]Part{"battery": battery, "drive": oldDrive}); !slices.Equal(missing, []string{"drive"}) {
		t.Fatalf("missing %v", missing)
	}
	// Complete; a retained part the index does not list is ignored.
	extra := mustPart(t, part(12, metric("gone.metric", "", "number")))
	cat, missing := Assemble(api.BoardAutopilot, idx, map[string]Part{"battery": battery, "drive": drive, "gone": extra})
	if len(missing) != 0 || cat.Revision == nil || *cat.Revision != 12 || cat.Board != api.BoardAutopilot {
		t.Fatalf("%+v %v", cat, missing)
	}
	if len(cat.Parts) != 2 || cat.Parts[0].Name != "battery" || cat.Parts[1].Name != "drive" || cat.Parts[1].Label != "Group" {
		t.Fatalf("parts %+v", cat.Parts)
	}
}

func TestAssembleStoredFollowsTheIndexRevision(t *testing.T) {
	stored := map[string][]byte{
		"index":   []byte(`{"revision": 2, "parts": ["a", "b"]}`),
		"a":       part(2, metric("a.x", "", "number")),
		"b":       part(1, metric("b.x", "", "number")),
		"retired": part(1, metric("retired.x", "", "number")),
	}
	if _, ok := assembleStored(api.BoardGateway, stored); ok {
		t.Fatal("complete with a part of the old revision")
	}
	stored["b"] = part(2, metric("b.x", "", "number"))
	cat, ok := assembleStored(api.BoardGateway, stored)
	if !ok || *cat.Revision != 2 || len(cat.Parts) != 2 {
		t.Fatalf("%+v %v", cat, ok)
	}
	delete(stored, "index")
	if _, ok := assembleStored(api.BoardGateway, stored); ok {
		t.Fatal("complete without an index")
	}
}

func catalogue(t *testing.T, board api.Board, metrics ...string) *api.BoardCatalogue {
	t.Helper()
	idx := Index{Revision: 1, Parts: []string{"all"}}
	cat, missing := Assemble(board, idx, map[string]Part{"all": mustPart(t, part(1, metrics...))})
	if len(missing) != 0 {
		t.Fatal(missing)
	}
	return &cat
}

func keyState(keys []api.KeyStatus, key string) api.KeyStatus {
	for _, k := range keys {
		if k.Key == key {
			return k
		}
	}
	panic("no key " + key)
}

func TestResolveKeysAcrossBothBoards(t *testing.T) {
	autopilot := catalogue(t, api.BoardAutopilot,
		metric("position.lat", "position.lat", "number"),
		metric("position.lon", "position.lon", "number"),
		metric("gnss.fix", "gnss.fix", "enum"),
		metric("battery.pct", "battery.level", "number"),
		metric("blade.on", "blade.on", "bool"),
	)
	gateway := catalogue(t, api.BoardGateway, metric("signal.rssi", "signal.strength", "number"))
	keys := ResolveKeys(autopilot, gateway)
	if len(keys) != len(Keys) {
		t.Fatalf("%d keys, want %d", len(keys), len(Keys))
	}
	// A key may be linked by a metric of either board.
	if k := keyState(keys, "signal.strength"); k.State != api.KeyLinked || *k.Board != api.BoardGateway || *k.Metric != "signal.rssi" {
		t.Fatalf("%+v", k)
	}
	if k := keyState(keys, "battery.level"); k.State != api.KeyLinked || *k.Metric != "battery.pct" {
		t.Fatalf("%+v", k)
	}
	// Not linked by any metric: reported as missing.
	for _, key := range []string{"position.heading", "path.point", "path.points"} {
		if k := keyState(keys, key); k.State != api.KeyMissing || k.Metric != nil || k.Board != nil || len(k.Candidates) != 0 {
			t.Fatalf("%s: %+v", key, k)
		}
	}
}

func TestResolveKeysLinkedTwiceCountsAsNotLinked(t *testing.T) {
	autopilot := catalogue(t, api.BoardAutopilot,
		metric("battery.pct", "battery.level", "number"),
		metric("battery.alt", "battery.level", "number"),
	)
	gateway := catalogue(t, api.BoardGateway, metric("signal.rssi", "signal.strength", "number"), metric("signal.alt", "signal.strength", "number"))
	// The same key on both boards counts too.
	autopilot2 := catalogue(t, api.BoardAutopilot, metric("signal.x", "signal.strength", "number"))
	keys := ResolveKeys(autopilot, gateway, autopilot2)

	if k := keyState(keys, "battery.level"); k.State != api.KeyDuplicate || k.Metric != nil || k.Board != nil ||
		!slices.Equal(k.Candidates, []string{"autopilot:battery.pct", "autopilot:battery.alt"}) {
		t.Fatalf("%+v", k)
	}
	if k := keyState(keys, "signal.strength"); k.State != api.KeyDuplicate || len(k.Candidates) != 3 {
		t.Fatalf("%+v", k)
	}
}

func TestResolveKeysWithoutACatalogue(t *testing.T) {
	for _, k := range ResolveKeys(nil, nil) {
		if k.State != api.KeyMissing {
			t.Fatalf("%+v", k)
		}
	}
	// A key the server does not know changes nothing.
	keys := ResolveKeys(catalogue(t, api.BoardGateway, metric("x.y", "unknown.key", "number")))
	if len(keys) != len(Keys) {
		t.Fatalf("%d keys", len(keys))
	}
	for _, k := range keys {
		if k.State != api.KeyMissing {
			t.Fatalf("%+v", k)
		}
	}
}

func TestResolveKeysChecksTheKeysType(t *testing.T) {
	cat := catalogue(t, api.BoardAutopilot,
		metric("blade.on", "blade.on", "number"), // a bool key
		metric("gnss.fix", "gnss.fix", "number"), // an enum key
		metric("path.point", "path.point", "number"),
	)
	keys := ResolveKeys(cat)
	for _, key := range []string{"blade.on", "gnss.fix"} {
		if k := keyState(keys, key); k.State != api.KeyWrongType || k.Metric == nil {
			t.Fatalf("%s: %+v", key, k)
		}
	}
	if k := keyState(keys, "path.point"); k.State != api.KeyLinked {
		t.Fatalf("%+v", k)
	}
	// An enum key needs the key's values in the key's order.
	swapped := strings.Replace(metric("gnss.fix", "gnss.fix", "enum"), `"none", "single"`, `"single", "none"`, 1)
	if k := keyState(ResolveKeys(catalogue(t, api.BoardAutopilot, swapped)), "gnss.fix"); k.State != api.KeyWrongType {
		t.Fatalf("%+v", k)
	}
	if k := keyState(ResolveKeys(catalogue(t, api.BoardAutopilot, metric("gnss.fix", "gnss.fix", "enum"))), "gnss.fix"); k.State != api.KeyLinked {
		t.Fatalf("%+v", k)
	}
}

func TestFindMetricMatchesFamilyMembers(t *testing.T) {
	cat := catalogue(t, api.BoardGateway,
		metric("usage.total.up", "", "number"),
		strings.Replace(metric("usage.mqtt.up.*", "", "number"), `"gauge"`, `"counter"`, 1),
	)
	if m, ok := FindMetric(*cat, "usage.total.up"); !ok || m.Name != "usage.total.up" {
		t.Fatal(m, ok)
	}
	if m, ok := FindMetric(*cat, "usage.mqtt.up.autopilot/telemetry"); !ok || m.Kind != "counter" {
		t.Fatal(m, ok)
	}
	for _, name := range []string{"usage.mqtt.up.", "usage.mqtt.up.a.b", "usage.mqtt.down.x", "usage"} {
		if _, ok := FindMetric(*cat, name); ok {
			t.Errorf("%s found", name)
		}
	}
}

func TestMetricNames(t *testing.T) {
	for _, ok := range []string{"battery.v", "drive.left.rpm", "a", "usage.mqtt.up.*"} {
		if !ValidCatalogueName(ok) {
			t.Errorf("%q rejected", ok)
		}
	}
	for _, bad := range []string{"", "Battery.v", "a..b", ".a", "a.", "a b", "a.*.b", "*", strings.Repeat("a", 201)} {
		if ValidCatalogueName(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
	if !ValidMetricName("usage.mqtt.up.autopilot/telemetry") || !ValidMetricName("usage.mqtt.up.mower/status/server") {
		t.Error("family member rejected")
	}
	if ValidMetricName("") || ValidMetricName("a\x00b") || ValidMetricName("a\nb") || ValidMetricName("\xff") {
		t.Error("odd name accepted")
	}
}
