package mower

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"unicode/utf8"

	"github.com/rmx-lt/rmx-server-app/internal/api"
)

// Metric catalogues: wiki Mower-Protocol §16.1 to §16.4. A board publishes an
// index (revision and part names) and one message per part; the server uses
// a catalogue only when it holds the index and every part it lists, all at
// the index's revision. Nothing here knows what a mower measures: it checks
// the shape of what the board sends and keeps it.

// IndexPart is the name of the catalogue part that lists the others.
const IndexPart = "index"

var (
	partNameRE   = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)
	metricNameRE = regexp.MustCompile(`^[a-z0-9_]+(\.[a-z0-9_]+)*$`)
	// familyNameRE is a name ending in ".*" (wiki §16.2, Families).
	familyNameRE = regexp.MustCompile(`^[a-z0-9_]+(\.[a-z0-9_]+)*\.\*$`)
)

// maxMetricName bounds a metric name as it appears in telemetry (a family member
// carries a topic name).
const maxMetricName = 200

// ValidPartName reports whether name is a catalogue part name.
func ValidPartName(name string) bool { return partNameRE.MatchString(name) }

// ValidCatalogueName reports whether name is a metric name of a catalogue
// entry: dotted parts of [a-z0-9_], or the same ending in ".*" for a family.
func ValidCatalogueName(name string) bool {
	return len(name) <= maxMetricName && (metricNameRE.MatchString(name) || familyNameRE.MatchString(name))
}

// ValidMetricName reports whether name can be a metric name in telemetry: a
// catalogue name, or a family member (the last part may hold any characters
// but a dot, wiki §16.2). The server does not look the name up in the
// catalogue; it only keeps odd bytes out of its tables.
func ValidMetricName(name string) bool {
	if name == "" || len(name) > maxMetricName || !utf8.ValidString(name) {
		return false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// Index is the parsed "index" part.
type Index struct {
	Revision int64
	Parts    []string
}

// ParseIndex checks an index message.
func ParseIndex(payload []byte) (Index, error) {
	var raw struct {
		Revision json.RawMessage `json:"revision"`
		Parts    []string        `json:"parts"`
	}
	if err := decodeObject(payload, &raw); err != nil {
		return Index{}, err
	}
	rev, err := wholeNumber(raw.Revision, "revision")
	if err != nil {
		return Index{}, err
	}
	if raw.Parts == nil {
		return Index{}, errors.New("parts is missing")
	}
	seen := map[string]bool{}
	for _, p := range raw.Parts {
		if !ValidPartName(p) {
			return Index{}, fmt.Errorf("part name %q is not valid", p)
		}
		if p == IndexPart {
			return Index{}, errors.New("the index lists itself")
		}
		if seen[p] {
			return Index{}, fmt.Errorf("part %q is listed twice", p)
		}
		seen[p] = true
	}
	return Index{Revision: rev, Parts: raw.Parts}, nil
}

// Part is a parsed catalogue part.
type Part struct {
	Revision int64
	Label    string
	Metrics  []api.CatalogueMetric
	// Skipped says, for each entry left out, why. They are logged, not shown.
	Skipped []string
}

// ParsePart checks a part message. A part that is not an object with a
// revision, a label and a metrics list is an error. An entry that does not
// follow §16.2 is left out and named in Skipped, so one bad entry does not
// hide the rest; a key it would have linked is then simply not linked.
func ParsePart(payload []byte) (Part, error) {
	var raw struct {
		Revision json.RawMessage   `json:"revision"`
		Label    *string           `json:"label"`
		Metrics  []json.RawMessage `json:"metrics"`
	}
	if err := decodeObject(payload, &raw); err != nil {
		return Part{}, err
	}
	rev, err := wholeNumber(raw.Revision, "revision")
	if err != nil {
		return Part{}, err
	}
	if raw.Label == nil {
		return Part{}, errors.New("label is missing")
	}
	if raw.Metrics == nil {
		return Part{}, errors.New("metrics is missing")
	}
	p := Part{Revision: rev, Label: *raw.Label, Metrics: []api.CatalogueMetric{}}
	names := map[string]bool{}
	for i, m := range raw.Metrics {
		metric, err := parseMetric(m)
		switch {
		case err != nil:
			p.Skipped = append(p.Skipped, fmt.Sprintf("entry %d: %v", i, err))
		case names[metric.Name]:
			p.Skipped = append(p.Skipped, fmt.Sprintf("entry %d: %q appears twice", i, metric.Name))
		default:
			names[metric.Name] = true
			p.Metrics = append(p.Metrics, metric)
		}
	}
	return p, nil
}

func parseMetric(b json.RawMessage) (api.CatalogueMetric, error) {
	var raw struct {
		Name        *string         `json:"name"`
		Key         *string         `json:"key"`
		Label       *string         `json:"label"`
		Description *string         `json:"description"`
		Unit        *string         `json:"unit"`
		Kind        *string         `json:"kind"`
		Type        *string         `json:"type"`
		Period      *float64        `json:"period"`
		Rates       []float64       `json:"rates"`
		Chart       *bool           `json:"chart"`
		Min         *float64        `json:"min"`
		Max         *float64        `json:"max"`
		Low         *float64        `json:"low"`
		High        *float64        `json:"high"`
		Decimals    json.RawMessage `json:"decimals"`
		Values      []string        `json:"values"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return api.CatalogueMetric{}, errors.New("not a metric object")
	}
	var missing []string
	need := func(ok bool, name string) {
		if !ok {
			missing = append(missing, name)
		}
	}
	need(raw.Name != nil, "name")
	need(raw.Label != nil, "label")
	need(raw.Description != nil, "description")
	need(raw.Unit != nil, "unit")
	need(raw.Kind != nil, "kind")
	need(raw.Type != nil, "type")
	need(raw.Period != nil, "period")
	need(raw.Rates != nil, "rates")
	need(raw.Chart != nil, "chart")
	if len(missing) > 0 {
		return api.CatalogueMetric{}, fmt.Errorf("missing %v", missing)
	}
	if !ValidCatalogueName(*raw.Name) {
		return api.CatalogueMetric{}, fmt.Errorf("name %q is not valid", *raw.Name)
	}
	if *raw.Kind != "gauge" && *raw.Kind != "counter" {
		return api.CatalogueMetric{}, fmt.Errorf("%s: kind %q is not gauge or counter", *raw.Name, *raw.Kind)
	}
	if *raw.Type != "number" && *raw.Type != "bool" && *raw.Type != "enum" {
		return api.CatalogueMetric{}, fmt.Errorf("%s: type %q is not number, bool or enum", *raw.Name, *raw.Type)
	}
	if *raw.Type == "enum" && len(raw.Values) == 0 {
		return api.CatalogueMetric{}, fmt.Errorf("%s: an enum needs values", *raw.Name)
	}
	if *raw.Period < 0 || math.IsInf(*raw.Period, 0) {
		return api.CatalogueMetric{}, fmt.Errorf("%s: period %v is not valid", *raw.Name, *raw.Period)
	}
	m := api.CatalogueMetric{
		Name: *raw.Name, Label: *raw.Label, Description: *raw.Description, Unit: *raw.Unit,
		Kind: *raw.Kind, Type: *raw.Type, Period: *raw.Period, Rates: raw.Rates, Chart: *raw.Chart,
		Min: raw.Min, Max: raw.Max, Low: raw.Low, High: raw.High, Values: raw.Values,
	}
	if m.Values == nil {
		m.Values = []string{}
	}
	if len(raw.Decimals) > 0 && string(raw.Decimals) != "null" {
		d, err := wholeNumber(raw.Decimals, "decimals")
		if err != nil || d > 20 {
			return api.CatalogueMetric{}, fmt.Errorf("%s: decimals %s is not valid", *raw.Name, raw.Decimals)
		}
		di := int(d)
		m.Decimals = &di
	}
	// A family cannot answer a key: its members are unknown until they appear.
	if raw.Key != nil && *raw.Key != "" && !familyNameRE.MatchString(m.Name) {
		m.Key = raw.Key
	}
	return m, nil
}

// Assemble builds the catalogue an index describes from the parts the server
// holds. It is complete only when every listed part is present with the
// index's revision; otherwise missing names the parts still needed (a part of
// another revision counts as missing).
func Assemble(board api.Board, idx Index, parts map[string]Part) (cat api.BoardCatalogue, missing []string) {
	cat = api.BoardCatalogue{Board: board, Parts: []api.CataloguePart{}, MissingParts: []string{}}
	for _, name := range idx.Parts {
		p, ok := parts[name]
		if !ok || p.Revision != idx.Revision {
			missing = append(missing, name)
			continue
		}
		cat.Parts = append(cat.Parts, api.CataloguePart{Name: name, Label: p.Label, Metrics: p.Metrics})
	}
	if len(missing) > 0 {
		return api.BoardCatalogue{}, missing
	}
	rev := idx.Revision
	cat.Revision = &rev
	return cat, nil
}

// decodeObject decodes payload, which must be one JSON object and nothing else.
func decodeObject(payload []byte, v any) error {
	payload = bytes.TrimSpace(payload)
	if len(payload) == 0 || payload[0] != '{' {
		return errors.New("not a JSON object")
	}
	dec := json.NewDecoder(bytes.NewReader(payload))
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	if dec.More() {
		return errors.New("invalid JSON: trailing data")
	}
	return nil
}

// wholeNumber reads a JSON number that must be a whole number of at least 0.
// raw is the member as sent: absent means missing, and a string or null is not a number.
func wholeNumber(raw json.RawMessage, name string) (int64, error) {
	s := string(bytes.TrimSpace(raw))
	if s == "" {
		return 0, fmt.Errorf("%s is missing", name)
	}
	if s[0] != '-' && (s[0] < '0' || s[0] > '9') {
		return 0, fmt.Errorf("%s must be a whole number", name)
	}
	if i, err := strconv.ParseInt(s, 10, 64); err == nil && i >= 0 {
		return i, nil
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil && f >= 0 && f == math.Trunc(f) && f < 1<<53 {
		return int64(f), nil
	}
	return 0, fmt.Errorf("%s must be a whole number", name)
}

// ---- Keys (wiki Mower-Protocol §16.4) --------------------------------------------

// KeySpec is one key of §16.4: the server's side of the interface to a mower.
type KeySpec struct {
	Key  string
	Type string
	// Values is the list of an enum key's values, in order (nil for the others).
	Values []string
}

// Keys is the list of §16.4. A key is added only when the server or the app
// starts to depend on a value, and then this list and the contract change together.
var Keys = []KeySpec{
	{Key: "position.lat", Type: "number"},
	{Key: "position.lon", Type: "number"},
	{Key: "position.heading", Type: "number"},
	{Key: "gnss.fix", Type: "enum", Values: []string{"none", "single", "dgps", "rtk_float", "rtk_fixed"}},
	{Key: "path.point", Type: "number"},
	{Key: "path.points", Type: "number"},
	{Key: "battery.level", Type: "number"},
	{Key: "blade.on", Type: "bool"},
	{Key: "signal.strength", Type: "number"},
}

// ResolveKeys resolves every key of §16.4 against the catalogues in use, one
// per board (nil or absent: no catalogue in use). A key that no metric links,
// or that more than one links, counts as not linked (§16.4). The metric that
// links a key must have the key's type, and an enum key's values must be the
// metric's values in the same order; otherwise the key is "wrong_type".
func ResolveKeys(cats ...*api.BoardCatalogue) []api.KeyStatus {
	type link struct {
		board  api.Board
		metric api.CatalogueMetric
	}
	links := map[string][]link{}
	for _, c := range cats {
		if c == nil {
			continue
		}
		for _, p := range c.Parts {
			for _, m := range p.Metrics {
				if m.Key != nil {
					links[*m.Key] = append(links[*m.Key], link{c.Board, m})
				}
			}
		}
	}
	out := make([]api.KeyStatus, 0, len(Keys))
	for _, spec := range Keys {
		st := api.KeyStatus{Key: spec.Key, Type: spec.Type, State: api.KeyMissing, Candidates: []string{}}
		l := links[spec.Key]
		for _, x := range l {
			st.Candidates = append(st.Candidates, string(x.board)+":"+x.metric.Name)
		}
		switch {
		case len(l) == 0:
		case len(l) > 1:
			st.State = api.KeyDuplicate
		default:
			b, name := l[0].board, l[0].metric.Name
			st.Board, st.Metric = &b, &name
			st.State = api.KeyLinked
			if l[0].metric.Type != spec.Type || (spec.Type == "enum" && !slices.Equal(l[0].metric.Values, spec.Values)) {
				st.State = api.KeyWrongType
			}
		}
		out = append(out, st)
	}
	return out
}
