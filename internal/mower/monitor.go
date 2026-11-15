package mower

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
)

// Monitor streams (wiki Mower-Protocol §15): a short, fast stream of chosen
// metrics of one board, started with monitor_start and kept alive while a
// client watches. The board ends a stream by itself `hold` seconds after the
// last monitor_start, so a stream nobody watches costs nothing: the server
// only extends it while the last watch request is recent, and says
// monitor_stop when the watching stops.

const (
	// monitorHold is the hold the server asks for, seconds (the contract allows 60).
	monitorHold = 15
	// monitorLease is how long after the last watch request a stream is kept alive.
	monitorLease = 15 * time.Second
	// monitorKeepAlive is how often monitor_start is sent again for a watched stream.
	monitorKeepAlive = 5 * time.Second
	// maxMonitorMetrics bounds the metrics of one stream; a message is at most 4096 bytes.
	maxMonitorMetrics = 40
)

type streamKey struct {
	device core.DeviceID
	board  api.Board
	rate   float64
	// metrics, sorted and joined by a newline.
	metrics string
}

// stream is one running (or starting) monitor stream.
type stream struct {
	key       streamKey
	session   string
	metrics   []string
	state     api.MonitorState
	lastWatch time.Time
	lastStart time.Time
}

type budgetKey struct {
	device core.DeviceID
	board  api.Board
}

type budget struct{ total, used float64 }

type monitors struct {
	mu      sync.Mutex
	streams map[streamKey]*stream
	budgets map[budgetKey]budget
}

func (m *monitors) init() {
	m.streams = map[streamKey]*stream{}
	m.budgets = map[budgetKey]budget{}
}

// describe is the API view of a stream; call it with mu held.
func (m *monitors) describe(st *stream) api.MonitorWatching {
	w := api.MonitorWatching{
		Device: string(st.key.device), Board: st.key.board, Session: st.session, State: st.state,
		Metrics: slices.Clone(st.metrics), Rate: st.key.rate,
	}
	if b, ok := m.budgets[budgetKey{st.key.device, st.key.board}]; ok {
		total, used := b.total, b.used
		w.Budget, w.Used = &total, &used
	}
	return w
}

// Watch starts a stream, or keeps the one that already runs for the same
// board, metrics and rate. It returns at once: the board's answer arrives as a
// MsgMonitor. The client sends it again every few seconds while it watches.
func (s *Service) Watch(ctx context.Context, user core.CurrentUser, req api.RequestMonitorWatch) (api.MonitorWatching, error) {
	device, ok := core.ParseDeviceID(req.Device)
	if !ok {
		return api.MonitorWatching{}, apperr.NotFound("device not found")
	}
	if req.Board != api.BoardGateway && req.Board != api.BoardAutopilot {
		return api.MonitorWatching{}, apperr.BadRequest("board must be gateway or autopilot")
	}
	if len(req.Metrics) < 1 || len(req.Metrics) > maxMonitorMetrics {
		return api.MonitorWatching{}, apperr.BadRequest("metrics takes 1 to %d names", maxMonitorMetrics)
	}
	if math.IsNaN(req.Rate) || math.IsInf(req.Rate, 0) || req.Rate <= 0 {
		return api.MonitorWatching{}, apperr.BadRequest("rate must be a number above 0")
	}
	metrics := slices.Clone(req.Metrics)
	slices.Sort(metrics)
	metrics = slices.Compact(metrics)
	for _, name := range metrics {
		if !ValidMetricName(name) || strings.HasSuffix(name, "*") {
			return api.MonitorWatching{}, apperr.BadRequest("%q is not a metric name (a family is named by a member, not with *)", truncate(name, 40))
		}
	}
	row, err := getDevice(ctx, s.pool, device)
	if errors.Is(err, errNoDevice) {
		return api.MonitorWatching{}, apperr.NotFound("device not found")
	}
	if err != nil {
		return api.MonitorWatching{}, apperr.DB(err)
	}
	if err := checkAllowed(row, req.Board, "monitor_start"); err != nil {
		return api.MonitorWatching{}, err
	}
	cats, err := loadCatalogues(ctx, s.pool, device)
	if err != nil {
		return api.MonitorWatching{}, apperr.DB(err)
	}
	if err := checkMetricsOffered(cats[req.Board], req.Board, metrics, req.Rate); err != nil {
		return api.MonitorWatching{}, err
	}

	key := streamKey{device, req.Board, req.Rate, strings.Join(metrics, "\n")}
	now := s.now()
	s.mon.mu.Lock()
	if st, ok := s.mon.streams[key]; ok {
		st.lastWatch = now
		w := s.mon.describe(st)
		s.mon.mu.Unlock()
		return w, nil
	}
	st := &stream{key: key, session: newID("m-"), metrics: metrics, state: api.MonitorStarting, lastWatch: now, lastStart: now}
	s.mon.streams[key] = st
	w := s.mon.describe(st)
	s.mon.mu.Unlock()

	if err := s.sendMonitorStart(ctx, st); err != nil {
		s.mon.mu.Lock()
		delete(s.mon.streams, key)
		s.mon.mu.Unlock()
		return api.MonitorWatching{}, err
	}
	s.send(api.MsgMonitor{Stream: w})
	return w, nil
}

// checkMetricsOffered checks the metrics and the rate against the catalogue in
// use, when there is one: every metric exists and offers the rate (§15). The
// board checks too; this saves the trip. Without a catalogue the board decides.
func checkMetricsOffered(cat api.BoardCatalogue, board api.Board, metrics []string, rate float64) error {
	if cat.Revision == nil {
		return nil
	}
	for _, name := range metrics {
		m, ok := FindMetric(cat, name)
		if !ok {
			return apperr.BadRequest("the %s has no metric %q", board, truncate(name, 40))
		}
		if !slices.Contains(m.Rates, rate) {
			return apperr.BadRequest("metric %q is not offered at %g samples per second", truncate(name, 40), rate)
		}
	}
	return nil
}

// Unwatch ends a stream at once.
func (s *Service) Unwatch(ctx context.Context, req api.RequestMonitorUnwatch) error {
	device, ok := core.ParseDeviceID(req.Device)
	if !ok {
		return apperr.NotFound("device not found")
	}
	s.mon.mu.Lock()
	var found *stream
	for _, st := range s.mon.streams {
		if st.key.device == device && st.session == req.Session {
			found = st
			break
		}
	}
	if found != nil {
		delete(s.mon.streams, found.key)
	}
	s.mon.mu.Unlock()
	if found == nil {
		return nil // a stream that is not running is stopped: done (§15)
	}
	s.stopStream(ctx, found, api.MonitorStopped, nil, nil)
	return nil
}

// Streams lists the streams the server keeps alive for a device.
func (s *Service) Streams(name string) (api.MonitorStreams, error) {
	device, ok := core.ParseDeviceID(name)
	if !ok {
		return api.MonitorStreams{}, apperr.NotFound("device not found")
	}
	out := api.MonitorStreams{Streams: []api.MonitorWatching{}}
	s.mon.mu.Lock()
	defer s.mon.mu.Unlock()
	for _, st := range s.mon.streams {
		if st.key.device == device {
			out.Streams = append(out.Streams, s.mon.describe(st))
		}
	}
	slices.SortFunc(out.Streams, func(a, b api.MonitorWatching) int { return strings.Compare(a.Session, b.Session) })
	return out, nil
}

// sendMonitorStart sends monitor_start for a stream (the first time, or as a
// keep-alive: the same session with a new command id, §15).
func (s *Service) sendMonitorStart(ctx context.Context, st *stream) error {
	raw := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	_, err := s.dispatch(ctx, outgoing{
		device: st.key.device, board: st.key.board, cmd: "monitor_start",
		params: map[string]json.RawMessage{
			"session": raw(st.session), "metrics": raw(st.metrics), "rate": raw(st.key.rate), "hold": raw(monitorHold),
		},
		hook: func(a Ack) { s.monitorStartAck(st, a) },
	})
	return err
}

// monitorStartAck handles the ack of a monitor_start: the budget it reports
// (on success and on failure, §15) and the stream's state.
func (s *Service) monitorStartAck(st *stream, a Ack) {
	var res struct {
		Budget *float64 `json:"budget"`
		Used   *float64 `json:"used"`
	}
	if a.Result != nil {
		_ = json.Unmarshal(a.Result, &res)
	}
	s.mon.mu.Lock()
	if res.Budget != nil && res.Used != nil {
		s.mon.budgets[budgetKey{st.key.device, st.key.board}] = budget{*res.Budget, *res.Used}
	}
	current := s.mon.streams[st.key] == st
	switch {
	case !current:
	case a.State == "accepted" || a.State == "done":
		st.state = api.MonitorRunning
	default:
		delete(s.mon.streams, st.key)
		st.state = api.MonitorFailed
	}
	w := s.mon.describe(st)
	s.mon.mu.Unlock()

	if !current {
		return // an ack for a stream that is gone; its budget was still worth keeping
	}
	msg := api.MsgMonitor{Stream: w}
	if a.State == "failed" {
		code := a.Error
		if code == "" {
			code = "failed"
		}
		msg.Error = &code
		if a.Message != "" {
			msg.Message = strp(a.Message)
		}
	}
	s.send(msg)
}

// stopStream sends monitor_stop (when the stream is not failed) and tells the clients.
func (s *Service) stopStream(ctx context.Context, st *stream, state api.MonitorState, code, message *string) {
	s.mon.mu.Lock()
	st.state = state
	w := s.mon.describe(st)
	s.mon.mu.Unlock()
	if state == api.MonitorStopped {
		raw, _ := json.Marshal(st.session)
		if _, err := s.dispatch(ctx, outgoing{
			device: st.key.device, board: st.key.board, cmd: "monitor_stop",
			params: map[string]json.RawMessage{"session": raw},
		}); err != nil {
			slog.Warn("sending monitor_stop failed", "device", string(st.key.device), "error", err)
		}
	}
	s.send(api.MsgMonitor{Stream: w, Error: code, Message: message})
}

// monitorTick keeps the watched streams alive and stops the others. It runs
// with every tick of the loop.
func (s *Service) monitorTick(ctx context.Context, now time.Time) {
	var keep, stop []*stream
	s.mon.mu.Lock()
	for key, st := range s.mon.streams {
		switch {
		case now.Sub(st.lastWatch) > monitorLease:
			delete(s.mon.streams, key)
			stop = append(stop, st)
		case now.Sub(st.lastStart) >= monitorKeepAlive:
			st.lastStart = now
			keep = append(keep, st)
		}
	}
	s.mon.mu.Unlock()
	for _, st := range stop {
		s.stopStream(ctx, st, api.MonitorStopped, nil, nil)
	}
	for _, st := range keep {
		if err := s.sendMonitorStart(ctx, st); err != nil {
			slog.Warn("sending a monitor keep-alive failed", "device", string(st.key.device), "error", err)
		}
	}
}

// ---- Samples ------------------------------------------------------------------------------

// Samples is a parsed samples message (§15).
type Samples struct {
	Session string
	Index   int64
	Time    time.Time
	Rate    float64
	Metrics []string
	Samples [][]*float64
}

// ParseSamples checks a samples message from <board>/monitor. A value is a
// number, a bool (1 or 0) or null.
func ParseSamples(payload []byte) (Samples, error) {
	var raw struct {
		Session string              `json:"session"`
		Index   json.RawMessage     `json:"index"`
		Time    json.RawMessage     `json:"time"`
		Rate    float64             `json:"rate"`
		Metrics []string            `json:"metrics"`
		Samples [][]json.RawMessage `json:"samples"`
	}
	if err := decodeObject(payload, &raw); err != nil {
		return Samples{}, err
	}
	if !core.ValidID(raw.Session) {
		return Samples{}, errors.New("session is missing or not valid")
	}
	index, err := wholeNumber(raw.Index, "index")
	if err != nil {
		return Samples{}, err
	}
	t, err := parseTime(raw.Time)
	if err != nil {
		return Samples{}, err
	}
	if t == nil {
		return Samples{}, errors.New("time is missing")
	}
	if math.IsNaN(raw.Rate) || math.IsInf(raw.Rate, 0) || raw.Rate <= 0 {
		return Samples{}, errors.New("rate must be a number above 0")
	}
	if len(raw.Metrics) == 0 {
		return Samples{}, errors.New("metrics is missing")
	}
	out := Samples{Session: raw.Session, Index: index, Time: *t, Rate: raw.Rate, Metrics: raw.Metrics}
	for i, row := range raw.Samples {
		if len(row) != len(raw.Metrics) {
			return Samples{}, fmt.Errorf("sample %d has %d values for %d metrics", i, len(row), len(raw.Metrics))
		}
		vals := make([]*float64, len(row))
		for j, v := range row {
			f, ok := parseValue(v)
			if !ok {
				return Samples{}, fmt.Errorf("sample %d value %d is not a number, bool or null", i, j)
			}
			vals[j] = f
		}
		out.Samples = append(out.Samples, vals)
	}
	return out, nil
}

// ingestSamples relays the samples of a stream somebody watches to the
// WebSocket. Samples of a stream nobody watches (it just ended) are dropped.
func (s *Service) ingestSamples(device core.DeviceID, board api.Board, payload []byte) error {
	smp, err := ParseSamples(payload)
	if err != nil {
		return bad(err)
	}
	s.mon.mu.Lock()
	var st *stream
	for _, c := range s.mon.streams {
		if c.key.device == device && c.key.board == board && c.session == smp.Session {
			st = c
			break
		}
	}
	var metrics []string
	if st != nil {
		metrics = st.metrics
	}
	s.mon.mu.Unlock()
	if st == nil {
		return nil
	}
	if !slices.Equal(metrics, smp.Metrics) && !sameSet(metrics, smp.Metrics) {
		return bad(errors.New("samples carry other metrics than the stream asked for"))
	}
	s.send(api.MsgMonitorSamples{
		Device: string(device), Board: board, Session: smp.Session, Index: smp.Index,
		Time: smp.Time.UTC(), Rate: smp.Rate, Metrics: smp.Metrics, Samples: smp.Samples,
	})
	return nil
}

func sameSet(a, b []string) bool {
	a, b = slices.Clone(a), slices.Clone(b)
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(a, b)
}
