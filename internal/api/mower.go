package api

import (
	"encoding/json"
	"time"
)

// The mower domain's browser contract: the devices the server has heard from,
// what their boards reported, and their stored metrics. The device side is
// wiki Mower-Protocol; what the server does with it is wiki Server-App.

// Board names a mower's board: "gateway" (the LTE board) or "autopilot".
type Board string

const (
	BoardGateway   Board = "gateway"
	BoardAutopilot Board = "autopilot"
)

// KeyState says whether the server can use one of the keys of wiki
// Mower-Protocol §16.4: "linked" (exactly one metric of a catalogue in use
// names the key, with the right type), "missing" (no metric names it, or no
// catalogue is in use yet), "duplicate" (more than one names it) or
// "wrong_type" (the one metric has another type than the key).
type KeyState string

const (
	KeyLinked    KeyState = "linked"
	KeyMissing   KeyState = "missing"
	KeyDuplicate KeyState = "duplicate"
	KeyWrongType KeyState = "wrong_type"
)

// DeviceSummary is one entry of GET /api/devices.
type DeviceSummary struct {
	Name      string    `json:"name"`
	FirstSeen time.Time `json:"first_seen_at"`
	LastSeen  time.Time `json:"last_seen_at"`
	// "online" or "offline" (the gateway's retained status); null before the first one.
	GatewayStatus *string `json:"gateway_status"`
	// The autopilot's mode from its last state; null when it has none.
	AutopilotMode *string `json:"autopilot_mode"`
	// True when the autopilot's state is out of date: the gateway is not
	// "online" or reports its autopilot link as not "up" (wiki Mower-Protocol §7.1).
	AutopilotStale bool `json:"autopilot_stale"`
}

// DeviceList is the answer to GET /api/devices.
type DeviceList struct {
	Devices []DeviceSummary `json:"devices"`
}

// BoardState is what the server knows about one board's state.
type BoardState struct {
	Board Board `json:"board"`
	// The last boot counter the board sent in any message; null before the first.
	Boot *int64 `json:"boot"`
	// When the server first saw that boot value.
	BootSeenAt *time.Time `json:"boot_seen_at"`
	// When the last state message arrived; null if none did.
	StateReceivedAt *time.Time `json:"state_received_at"`
	// The state message as the board published it (the fields are in wiki
	// Mower-Protocol §6.2 and §7.1); null if none arrived.
	State json.RawMessage `json:"state"`
	// Whether the server supports the protocol version in State; null when the
	// state has none.
	ProtocolSupported *bool `json:"protocol_supported"`
}

// CatalogueMetric is one metric of a board's catalogue (wiki Mower-Protocol §16.2).
type CatalogueMetric struct {
	Name string `json:"name"`
	// The server key this metric answers; null for none.
	Key         *string `json:"key"`
	Label       string  `json:"label"`
	Description string  `json:"description"`
	Unit        string  `json:"unit"`
	// "gauge" or "counter".
	Kind string `json:"kind"`
	// "number", "bool" or "enum".
	Type     string    `json:"type"`
	Period   float64   `json:"period"`
	Rates    []float64 `json:"rates"`
	Chart    bool      `json:"chart"`
	Min      *float64  `json:"min"`
	Max      *float64  `json:"max"`
	Low      *float64  `json:"low"`
	High     *float64  `json:"high"`
	Decimals *int      `json:"decimals"`
	// The names of an enum metric's values, in order; empty otherwise.
	Values []string `json:"values"`
}

// CataloguePart is one part of a catalogue: a group of metrics.
type CataloguePart struct {
	Name    string            `json:"name"`
	Label   string            `json:"label"`
	Metrics []CatalogueMetric `json:"metrics"`
}

// BoardCatalogue is the metric catalogue of one board, as the server uses it.
type BoardCatalogue struct {
	Board Board `json:"board"`
	// The revision in use; null when no complete catalogue has arrived yet.
	Revision *int64 `json:"revision"`
	// The parts of the revision in use, in the order of the index.
	Parts []CataloguePart `json:"parts"`
	// A newer revision the index announces whose parts have not all arrived;
	// the server keeps using Revision until they have. Null for none.
	PendingRevision *int64 `json:"pending_revision"`
	// The parts of the pending revision that are still missing.
	MissingParts []string `json:"missing_parts"`
}

// KeyStatus is how one key of wiki Mower-Protocol §16.4 resolves.
type KeyStatus struct {
	Key string `json:"key"`
	// "number", "bool" or "enum".
	Type  string   `json:"type"`
	State KeyState `json:"state"`
	// The metric that answers the key; null unless State is "linked" or "wrong_type".
	Board  *Board  `json:"board"`
	Metric *string `json:"metric"`
	// Every metric that names the key as "<board>:<metric>" (more than one for "duplicate").
	Candidates []string `json:"candidates"`
}

// LatestValue is the newest value the server stored for one metric.
type LatestValue struct {
	Board  Board     `json:"board"`
	Metric string    `json:"metric"`
	Time   time.Time `json:"time"`
	Boot   int64     `json:"boot"`
	// A bool is 0 or 1, an enum its index. Null when the board said the value is not known.
	Value *float64 `json:"value"`
}

// DeviceDetail is the answer to GET /api/devices/{name}: everything the
// server knows about a device except the metric history and the events.
type DeviceDetail struct {
	Name      string    `json:"name"`
	FirstSeen time.Time `json:"first_seen_at"`
	LastSeen  time.Time `json:"last_seen_at"`
	// "online" or "offline"; null before the first status.
	GatewayStatus *string `json:"gateway_status"`
	// True when the autopilot's state is out of date, see DeviceSummary.
	AutopilotStale bool             `json:"autopilot_stale"`
	Gateway        BoardState       `json:"gateway"`
	Autopilot      BoardState       `json:"autopilot"`
	Catalogues     []BoardCatalogue `json:"catalogues"`
	Keys           []KeyStatus      `json:"keys"`
	Latest         []LatestValue    `json:"latest"`
}

// MetricPoint is one stored value of a metric.
type MetricPoint struct {
	Time time.Time `json:"time"`
	Boot int64     `json:"boot"`
	// The stored value, or for a counter shown as a rate, units per second.
	Value float64 `json:"value"`
}

// MetricHistory is the answer to GET /api/devices/{name}/history.
type MetricHistory struct {
	Device string `json:"device"`
	Board  Board  `json:"board"`
	Metric string `json:"metric"`
	// "gauge" or "counter" from the catalogue in use; empty when the catalogue has no such metric.
	MetricKind string `json:"metric_kind"`
	// True when Points are rates of a counter (per second) instead of stored values.
	Rate bool `json:"rate"`
	// Oldest first.
	Points []MetricPoint `json:"points"`
	// True when more points matched than the limit allows; the newest are returned.
	Truncated bool `json:"truncated"`
}

// DeviceEvent is one event of a board (wiki Mower-Protocol §7.3).
type DeviceEvent struct {
	Board Board     `json:"board"`
	Boot  int64     `json:"boot"`
	Seq   int64     `json:"seq"`
	Time  time.Time `json:"time"`
	Event string    `json:"event"`
	// The event's other fields as the board sent them.
	Data       json.RawMessage `json:"data"`
	ReceivedAt time.Time       `json:"received_at"`
}

// DeviceEventList is the answer to GET /api/devices/{name}/events.
type DeviceEventList struct {
	Events []DeviceEvent `json:"events"`
}

// ---- WebSocket ----------------------------------------------------------------

// RequestDevices asks for the DeviceList.
type RequestDevices struct{}

// RequestDevice asks for the DeviceDetail of one device.
type RequestDevice struct {
	Name string `json:"name"`
}

// RequestMetricHistory asks for the MetricHistory of one metric.
type RequestMetricHistory struct {
	Device string `json:"device"`
	Board  Board  `json:"board"`
	Metric string `json:"metric"`
	// Defaults: the hour before To.
	From *time.Time `json:"from"`
	// Default: now.
	To *time.Time `json:"to"`
	// At most this many points, newest kept (default 2000, at most 10000).
	Limit *int `json:"limit"`
	// Rate of change instead of values; default true for a counter, false otherwise.
	Rate *bool `json:"rate"`
}

// MetricValue is one metric value of a telemetry message.
type MetricValue struct {
	Metric string   `json:"metric"`
	Value  *float64 `json:"value"`
}

// MsgDeviceChanged is pushed when something about a device changed that a
// client shows: Change is "status" (the gateway's online/offline), "state"
// (a board's state), "boot" (a board restarted), "catalogue" (a catalogue in
// use changed, which may change the keys) or "event". The client loads the
// device again.
type MsgDeviceChanged struct {
	Device string `json:"device"`
	Board  *Board `json:"board"`
	Change string `json:"change"`
}

// MsgTelemetry is pushed for every telemetry message the server stores, so a
// live view needs no polling.
type MsgTelemetry struct {
	Device string        `json:"device"`
	Board  Board         `json:"board"`
	Time   time.Time     `json:"time"`
	Boot   int64         `json:"boot"`
	Values []MetricValue `json:"values"`
}
