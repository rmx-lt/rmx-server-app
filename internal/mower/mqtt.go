package mower

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/mqtt"
)

// Device payloads (wiki Mower-Protocol §3, §4, §6, §7, §16): what the boards
// publish and how the server reads it. The domain subscribes to everything
// under gateway/ and autopilot/ and handles the topics below; the rest of
// those trees (commands, acks, monitor, chunk transfer) belongs to other features.

// Roots of the device topic trees the domain subscribes to (<prefix>/+/<root>/#).
const (
	RootGateway   = "gateway"
	RootAutopilot = "autopilot"
)

// MaxPayloadBytes is the size limit of a JSON message on MQTT (§4).
const MaxPayloadBytes = 4096

// ProtocolMajor and ProtocolMinor are the contract version the server
// implements (wiki Mower-Protocol §2).
const (
	ProtocolMajor = 0
	ProtocolMinor = 1
)

// maxClockSkew is how far a board's time may be from the server's before the
// server stores a message under its own time of arrival instead. A board that
// reports an absurd time must not make the database chunk the data into the
// distant past or future.
const maxClockSkew = 24 * time.Hour

// Register routes the device topic trees of the mower domain to svc. Call it
// before the client starts.
func Register(c *mqtt.Client, svc *Service) {
	c.HandleTree(RootGateway, svc.HandleMessage)
	c.HandleTree(RootAutopilot, svc.HandleMessage)
}

// Topic kinds below <prefix>/<device>/.
type topicKind int

const (
	topicOther topicKind = iota
	topicStatus
	topicState
	topicTelemetry
	topicEvent
	topicMetrics
)

// parseSuffix classifies a topic suffix such as "gateway/metrics/battery".
// part is the catalogue part for topicMetrics.
func parseSuffix(suffix string) (board api.Board, kind topicKind, part string) {
	root, rest, ok := strings.Cut(suffix, "/")
	if !ok {
		return "", topicOther, ""
	}
	switch root {
	case RootGateway:
		board = api.BoardGateway
	case RootAutopilot:
		board = api.BoardAutopilot
	default:
		return "", topicOther, ""
	}
	switch {
	case rest == "state":
		return board, topicState, ""
	case rest == "telemetry":
		return board, topicTelemetry, ""
	case rest == "status" && board == api.BoardGateway:
		return board, topicStatus, ""
	case rest == "event" && board == api.BoardAutopilot:
		return board, topicEvent, ""
	}
	if p, ok := strings.CutPrefix(rest, "metrics/"); ok && ValidPartName(p) {
		return board, topicMetrics, p
	}
	return board, topicOther, ""
}

// ---- State ----------------------------------------------------------------------------

// State is the part of a board's state message the server reads itself; the
// message is kept whole and shown as it came.
type State struct {
	Boot     *int64
	Protocol string
	// Mode is the autopilot's mode; AutopilotLink the gateway's view of the board link.
	Mode          string
	AutopilotLink string
}

// ParseState checks a state message: one JSON object. Fields the server does
// not read are ignored (§2); the ones it does read are optional here, because
// a message with a field missing is still the board's state.
func ParseState(payload []byte) (State, error) {
	var raw struct {
		Boot          json.RawMessage `json:"boot"`
		Protocol      *string         `json:"protocol"`
		Mode          *string         `json:"mode"`
		AutopilotLink *string         `json:"autopilot_link"`
	}
	if err := decodeObject(payload, &raw); err != nil {
		return State{}, err
	}
	var s State
	if len(raw.Boot) > 0 {
		boot, err := wholeNumber(raw.Boot, "boot")
		if err != nil {
			return State{}, err
		}
		s.Boot = &boot
	}
	if raw.Protocol != nil {
		s.Protocol = *raw.Protocol
	}
	if raw.Mode != nil {
		s.Mode = *raw.Mode
	}
	if raw.AutopilotLink != nil {
		s.AutopilotLink = *raw.AutopilotLink
	}
	return s, nil
}

// ProtocolSupported reports whether the server supports a board that reports
// protocol (wiki §2): the same major version. While the major version is 0 a
// minor version may change anything, so then the minor must match too.
func ProtocolSupported(protocol string) bool {
	maj, min, ok := strings.Cut(protocol, ".")
	if !ok {
		return false
	}
	major, err1 := strconv.Atoi(maj)
	minor, err2 := strconv.Atoi(min)
	if err1 != nil || err2 != nil || major < 0 || minor < 0 {
		return false
	}
	if major != ProtocolMajor {
		return false
	}
	return major != 0 || minor == ProtocolMinor
}

// AutopilotStale reports whether the autopilot's state is out of date: the
// gateway's status is not "online", or the gateway's state says its autopilot
// link is not "up" (§7.1). Without a status or a gateway state yet, the
// server cannot know the link is up, so the state counts as out of date.
func AutopilotStale(gatewayStatus string, gatewayLink string) bool {
	return gatewayStatus != StatusOnline || gatewayLink != "up"
}

// Gateway status values (§6.1).
const (
	StatusOnline  = "online"
	StatusOffline = "offline"
)

// ParseStatus reads the plain-text gateway status.
func ParseStatus(payload []byte) (string, error) {
	switch s := string(bytes.TrimSpace(payload)); s {
	case StatusOnline, StatusOffline:
		return s, nil
	default:
		return "", fmt.Errorf("status %q is not online or offline", truncate(s, 20))
	}
}

// ---- Telemetry (§6.3, §7.2, §16.3) -----------------------------------------------------

// Reading is one metric value of a telemetry message; Value is nil when the
// board said the value is not known (null).
type Reading struct {
	Metric string
	Value  *float64
}

// Telemetry is a parsed telemetry message.
type Telemetry struct {
	// Time is the board's time, nil while its clock is not set.
	Time     *time.Time
	Boot     int64
	Readings []Reading
	// Skipped counts values that were neither a number, a bool nor null, or had an invalid name.
	Skipped int
}

// ParseTelemetry checks a telemetry message. A number is stored as it is, a
// bool as 1 or 0 and an enum as its index (the board sends the index). null
// stays null: the value is not known.
func ParseTelemetry(payload []byte) (Telemetry, error) {
	var raw struct {
		Time    json.RawMessage            `json:"time"`
		Boot    json.RawMessage            `json:"boot"`
		Metrics map[string]json.RawMessage `json:"metrics"`
	}
	if err := decodeObject(payload, &raw); err != nil {
		return Telemetry{}, err
	}
	boot, err := wholeNumber(raw.Boot, "boot")
	if err != nil {
		return Telemetry{}, err
	}
	if raw.Metrics == nil {
		return Telemetry{}, errors.New("metrics is missing")
	}
	t, err := parseTime(raw.Time)
	if err != nil {
		return Telemetry{}, err
	}
	out := Telemetry{Time: t, Boot: boot}
	names := make([]string, 0, len(raw.Metrics))
	for name := range raw.Metrics {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		if !ValidMetricName(name) {
			out.Skipped++
			continue
		}
		v, ok := parseValue(raw.Metrics[name])
		if !ok {
			out.Skipped++
			continue
		}
		out.Readings = append(out.Readings, Reading{Metric: name, Value: v})
	}
	return out, nil
}

// parseValue reads a metric value: number, bool or null.
func parseValue(b json.RawMessage) (*float64, bool) {
	s := string(bytes.TrimSpace(b))
	switch s {
	case "null":
		return nil, true
	case "true":
		one := 1.0
		return &one, true
	case "false":
		zero := 0.0
		return &zero, true
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || s == "" || (s[0] != '-' && (s[0] < '0' || s[0] > '9')) {
		return nil, false
	}
	return &f, true
}

// parseTime reads a "time" field: absent or null (clock not set) gives nil.
func parseTime(b json.RawMessage) (*time.Time, error) {
	s := string(bytes.TrimSpace(b))
	if s == "" || s == "null" {
		return nil, nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 || f > 1e11 {
		return nil, errors.New("time must be Unix time in seconds")
	}
	sec, frac := math.Modf(f)
	t := time.Unix(int64(sec), int64(frac*1e9)).UTC()
	return &t, nil
}

// StoredTime is the time a message is stored under: the board's time, or the
// time of arrival when the board has no clock yet or its clock is off by more
// than maxClockSkew.
func StoredTime(boardTime *time.Time, arrived time.Time) time.Time {
	if boardTime == nil {
		return arrived
	}
	if d := boardTime.Sub(arrived); d > maxClockSkew || d < -maxClockSkew {
		return arrived
	}
	return *boardTime
}

// ---- Events (§7.3) -------------------------------------------------------------------------

// Event is a parsed autopilot event. Data holds its other fields.
type Event struct {
	Time *time.Time
	Boot int64
	Seq  int64
	Name string
	Data json.RawMessage
}

// ParseEvent checks an event: time, boot, seq and event are required (time
// may be null while the clock is not set). Everything else is kept as Data.
func ParseEvent(payload []byte) (Event, error) {
	var raw map[string]json.RawMessage
	if err := decodeObject(payload, &raw); err != nil {
		return Event{}, err
	}
	for _, f := range []string{"time", "boot", "seq", "event"} {
		if _, ok := raw[f]; !ok {
			return Event{}, fmt.Errorf("%s is missing", f)
		}
	}
	t, err := parseTime(raw["time"])
	if err != nil {
		return Event{}, err
	}
	boot, err := wholeNumber(raw["boot"], "boot")
	if err != nil {
		return Event{}, err
	}
	seq, err := wholeNumber(raw["seq"], "seq")
	if err != nil {
		return Event{}, err
	}
	var name string
	if err := json.Unmarshal(raw["event"], &name); err != nil || name == "" || len(name) > 64 {
		return Event{}, errors.New("event must be a name")
	}
	for _, f := range []string{"time", "boot", "seq", "event"} {
		delete(raw, f)
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return Event{}, err
	}
	return Event{Time: t, Boot: boot, Seq: seq, Name: name, Data: data}, nil
}

// ---- Counters (§16.3) ----------------------------------------------------------------------

// Sample is one stored value of a metric.
type Sample struct {
	Time  time.Time
	Boot  int64
	Value float64
}

// CounterRates turns the samples of a counter, oldest first, into rates: the
// growth since the previous sample divided by the seconds between them.
// A counter counts since the board started, so the first sample of each boot
// has no rate (a new boot value means the counter started again from 0, §4.1)
// and is left out; so is a pair of samples with the same time or a count that
// went down within one boot.
func CounterRates(samples []Sample) []Sample {
	out := make([]Sample, 0, len(samples))
	for i := 1; i < len(samples); i++ {
		prev, cur := samples[i-1], samples[i]
		dt := cur.Time.Sub(prev.Time).Seconds()
		if cur.Boot != prev.Boot || dt <= 0 || cur.Value < prev.Value {
			continue
		}
		out = append(out, Sample{Time: cur.Time, Boot: cur.Boot, Value: (cur.Value - prev.Value) / dt})
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
