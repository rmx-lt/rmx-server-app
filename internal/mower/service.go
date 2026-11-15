// Package mower is the server's view of the mowers (wiki Mower-Protocol and
// wiki Server-App, "Mower ingest"): the devices it learns from the topics
// under mower/<name>/gateway/ and mower/<name>/autopilot/, the state and
// metric catalogues of both boards, the telemetry as time series by metric
// name, the autopilot's events, and the API and WebSocket that show it.
//
// The server holds no formulas or hardware constants here: it stores and
// shows what the mower sends. The only things it knows about a mower are the
// keys of wiki Mower-Protocol §16.4 (Keys in catalogue.go).
package mower

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/db"
)

// Limits of the history and events queries.
const (
	defaultHistoryPoints = 2000
	maxHistoryPoints     = 10000
	defaultHistoryWindow = time.Hour
	defaultEvents        = 100
	maxEvents            = 1000
)

// Pusher sends a message to every open WebSocket (ws.Server).
type Pusher interface {
	Push(api.ServerMessage)
}

// Service ingests what the mowers publish and answers questions about it.
type Service struct {
	pool *db.Pool
	push Pusher
	// now is the clock; tests replace it.
	now func() time.Time
}

// New returns the service. pool may be nil in tests that never reach the
// database; push may be nil (nothing is pushed).
func New(pool *db.Pool, push Pusher) *Service {
	return &Service{pool: pool, push: push, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) send(msg any) {
	if s.push == nil {
		return
	}
	switch m := msg.(type) {
	case api.MsgDeviceChanged:
		s.push.Push(api.ServerMessage{V: m})
	case api.MsgTelemetry:
		s.push.Push(api.ServerMessage{V: m})
	}
}

func (s *Service) changed(device core.DeviceID, board *api.Board, change string) {
	s.send(api.MsgDeviceChanged{Device: string(device), Board: board, Change: change})
}

// ---- Ingest -------------------------------------------------------------------------------

// HandleMessage handles one message under mower/<device>/gateway/ or
// mower/<device>/autopilot/. suffix is the topic below the device ("gateway/state").
// A message that does not follow the contract is logged and dropped: nothing a
// device sends may stop the server or damage what it holds.
func (s *Service) HandleMessage(ctx context.Context, device core.DeviceID, suffix string, payload []byte) {
	board, kind, part := parseSuffix(suffix)
	if kind == topicOther {
		return // commands, acks, monitor, chunk transfer: other features
	}
	if len(payload) == 0 {
		return // an emptied retained topic
	}
	log := slog.With("device", string(device), "topic", suffix)
	if len(payload) > MaxPayloadBytes {
		log.Warn("dropping a message over the size limit", "bytes", len(payload))
		return
	}
	var err error
	switch kind {
	case topicStatus:
		err = s.ingestStatus(ctx, device, payload)
	case topicState:
		err = s.ingestState(ctx, device, board, payload)
	case topicTelemetry:
		err = s.ingestTelemetry(ctx, device, board, payload)
	case topicEvent:
		err = s.ingestEvent(ctx, device, board, payload)
	case topicMetrics:
		err = s.ingestCatalogue(ctx, device, board, part, payload)
	}
	var bad badMessage
	switch {
	case err == nil:
	case errors.As(err, &bad):
		log.Warn("dropping a message that does not follow the contract", "reason", bad.Error())
	case ctx.Err() == nil:
		log.Error("storing a message failed", "error", err)
	}
}

// badMessage is a message that does not follow the contract.
type badMessage struct{ error }

func (b badMessage) Unwrap() error { return b.error }

func bad(err error) error { return badMessage{err} }

func (s *Service) ingestStatus(ctx context.Context, device core.DeviceID, payload []byte) error {
	status, err := ParseStatus(payload)
	if err != nil {
		return bad(err)
	}
	now := s.now()
	err = db.InTx(ctx, s.pool, func(tx db.DBTX) error {
		if err := touchDevice(ctx, tx, device, now); err != nil {
			return err
		}
		return setGatewayStatus(ctx, tx, device, status, now)
	})
	if err == nil {
		s.changed(device, nil, "status")
	}
	return err
}

func (s *Service) ingestState(ctx context.Context, device core.DeviceID, board api.Board, payload []byte) error {
	st, err := ParseState(payload)
	if err != nil {
		return bad(err)
	}
	now := s.now()
	var restarted bool
	err = db.InTx(ctx, s.pool, func(tx db.DBTX) error {
		if err := touchDevice(ctx, tx, device, now); err != nil {
			return err
		}
		if st.Boot != nil {
			var err error
			if restarted, err = noteBoot(ctx, tx, device, board, *st.Boot, now); err != nil {
				return err
			}
		}
		return saveState(ctx, tx, device, board, payload, now)
	})
	if err == nil {
		if restarted {
			s.changed(device, &board, "boot")
		}
		s.changed(device, &board, "state")
	}
	return err
}

func (s *Service) ingestTelemetry(ctx context.Context, device core.DeviceID, board api.Board, payload []byte) error {
	t, err := ParseTelemetry(payload)
	if err != nil {
		return bad(err)
	}
	if t.Skipped > 0 {
		slog.Warn("telemetry values left out: not a number, bool or null, or an invalid name",
			"device", string(device), "board", string(board), "count", t.Skipped)
	}
	now := s.now()
	at := StoredTime(t.Time, now)
	var restarted bool
	err = db.InTx(ctx, s.pool, func(tx db.DBTX) error {
		if err := touchDevice(ctx, tx, device, now); err != nil {
			return err
		}
		var err error
		if restarted, err = noteBoot(ctx, tx, device, board, t.Boot, now); err != nil {
			return err
		}
		return saveTelemetry(ctx, tx, device, board, t.Boot, at, t.Readings)
	})
	if err != nil {
		return err
	}
	if restarted {
		s.changed(device, &board, "boot")
	}
	values := make([]api.MetricValue, len(t.Readings))
	for i, r := range t.Readings {
		values[i] = api.MetricValue{Metric: r.Metric, Value: r.Value}
	}
	s.send(api.MsgTelemetry{Device: string(device), Board: board, Time: at, Boot: t.Boot, Values: values})
	return nil
}

func (s *Service) ingestEvent(ctx context.Context, device core.DeviceID, board api.Board, payload []byte) error {
	e, err := ParseEvent(payload)
	if err != nil {
		return bad(err)
	}
	now := s.now()
	var fresh, restarted bool
	err = db.InTx(ctx, s.pool, func(tx db.DBTX) error {
		if err := touchDevice(ctx, tx, device, now); err != nil {
			return err
		}
		var err error
		if restarted, err = noteBoot(ctx, tx, device, board, e.Boot, now); err != nil {
			return err
		}
		fresh, err = saveEvent(ctx, tx, device, board, e, StoredTime(e.Time, now), now)
		return err
	})
	if err != nil {
		return err
	}
	if restarted {
		s.changed(device, &board, "boot")
	}
	if fresh {
		s.changed(device, &board, "event")
	} else {
		slog.Debug("dropping an event already seen", "device", string(device), "boot", e.Boot, "seq", e.Seq)
	}
	return nil
}

func (s *Service) ingestCatalogue(ctx context.Context, device core.DeviceID, board api.Board, part string, payload []byte) error {
	var revision int64
	if part == IndexPart {
		idx, err := ParseIndex(payload)
		if err != nil {
			return bad(err)
		}
		revision = idx.Revision
	} else {
		p, err := ParsePart(payload)
		if err != nil {
			return bad(err)
		}
		revision = p.Revision
		if len(p.Skipped) > 0 {
			slog.Warn("catalogue entries left out", "device", string(device), "board", string(board), "part", part, "reasons", p.Skipped)
		}
	}
	now := s.now()
	var changed bool
	err := db.InTx(ctx, s.pool, func(tx db.DBTX) error {
		if err := touchDevice(ctx, tx, device, now); err != nil {
			return err
		}
		if err := savePart(ctx, tx, device, board, part, revision, payload, now); err != nil {
			return err
		}
		stored, err := loadParts(ctx, tx, device, board)
		if err != nil {
			return err
		}
		cat, ok := assembleStored(board, stored)
		if !ok {
			return nil
		}
		changed, err = saveCatalogue(ctx, tx, device, board, cat, now)
		return err
	})
	if err == nil && changed {
		s.changed(device, &board, "catalogue")
	}
	return err
}

// assembleStored builds the catalogue the stored messages of a board
// describe, if they are complete (see Assemble).
func assembleStored(board api.Board, stored map[string][]byte) (api.BoardCatalogue, bool) {
	idx, parts, ok := parseStored(stored)
	if !ok {
		return api.BoardCatalogue{}, false
	}
	cat, missing := Assemble(board, idx, parts)
	return cat, len(missing) == 0
}

// parseStored reads the index and the parts it lists from stored messages.
// Messages are checked before they are stored, so one that no longer parses
// counts as absent.
func parseStored(stored map[string][]byte) (Index, map[string]Part, bool) {
	raw, ok := stored[IndexPart]
	if !ok {
		return Index{}, nil, false
	}
	idx, err := ParseIndex(raw)
	if err != nil {
		return Index{}, nil, false
	}
	parts := map[string]Part{}
	for _, name := range idx.Parts {
		if doc, ok := stored[name]; ok {
			if p, err := ParsePart(doc); err == nil {
				parts[name] = p
			}
		}
	}
	return idx, parts, true
}

// ---- Queries --------------------------------------------------------------------------------

// Devices lists every device the server has heard from.
func (s *Service) Devices(ctx context.Context) (api.DeviceList, error) {
	rows, err := listDevices(ctx, s.pool)
	if err != nil {
		return api.DeviceList{}, apperr.DB(err)
	}
	out := api.DeviceList{Devices: make([]api.DeviceSummary, 0, len(rows))}
	for _, r := range rows {
		sum := api.DeviceSummary{Name: r.name, FirstSeen: r.firstSeen, LastSeen: r.lastSeen, GatewayStatus: r.gatewayStatus}
		if st, err := ParseState(r.autopilot.state); err == nil && r.autopilot.state != nil && st.Mode != "" {
			mode := st.Mode
			sum.AutopilotMode = &mode
		}
		sum.AutopilotStale = stale(r)
		out.Devices = append(out.Devices, sum)
	}
	return out, nil
}

func stale(r deviceRow) bool {
	status := ""
	if r.gatewayStatus != nil {
		status = *r.gatewayStatus
	}
	link := ""
	if r.gateway.state != nil {
		if st, err := ParseState(r.gateway.state); err == nil {
			link = st.AutopilotLink
		}
	}
	return AutopilotStale(status, link)
}

// Device returns everything the server knows about one device except the metric history and the events.
func (s *Service) Device(ctx context.Context, name string) (api.DeviceDetail, error) {
	id, ok := core.ParseDeviceID(name)
	if !ok {
		return api.DeviceDetail{}, apperr.NotFound("device not found")
	}
	row, err := getDevice(ctx, s.pool, id)
	if errors.Is(err, errNoDevice) {
		return api.DeviceDetail{}, apperr.NotFound("device not found")
	}
	if err != nil {
		return api.DeviceDetail{}, apperr.DB(err)
	}
	cats, err := loadCatalogues(ctx, s.pool, id)
	if err != nil {
		return api.DeviceDetail{}, apperr.DB(err)
	}
	latest, err := listLatest(ctx, s.pool, id)
	if err != nil {
		return api.DeviceDetail{}, apperr.DB(err)
	}
	d := api.DeviceDetail{
		Name: row.name, FirstSeen: row.firstSeen, LastSeen: row.lastSeen,
		GatewayStatus:  row.gatewayStatus,
		AutopilotStale: stale(row),
		Gateway:        boardState(api.BoardGateway, row.gateway),
		Autopilot:      boardState(api.BoardAutopilot, row.autopilot),
		Latest:         latest,
	}
	if d.Latest == nil {
		d.Latest = []api.LatestValue{}
	}
	var inUse []*api.BoardCatalogue
	for _, board := range []api.Board{api.BoardGateway, api.BoardAutopilot} {
		cat, have := cats[board]
		if !have {
			cat = api.BoardCatalogue{Board: board, Parts: []api.CataloguePart{}, MissingParts: []string{}}
		} else {
			inUse = append(inUse, &cat)
		}
		if err := s.pending(ctx, id, board, &cat); err != nil {
			return api.DeviceDetail{}, apperr.DB(err)
		}
		d.Catalogues = append(d.Catalogues, cat)
	}
	d.Keys = ResolveKeys(inUse...)
	return d, nil
}

// pending fills in a newer revision the index announces and the parts of it still missing.
func (s *Service) pending(ctx context.Context, id core.DeviceID, board api.Board, cat *api.BoardCatalogue) error {
	stored, err := loadParts(ctx, s.pool, id, board)
	if err != nil {
		return err
	}
	idx, parts, ok := parseStored(stored)
	if !ok || (cat.Revision != nil && *cat.Revision == idx.Revision) {
		return nil
	}
	_, missing := Assemble(board, idx, parts)
	if len(missing) == 0 {
		return nil // complete: saveCatalogue has it, or is about to
	}
	rev := idx.Revision
	cat.PendingRevision, cat.MissingParts = &rev, missing
	return nil
}

func boardState(board api.Board, r boardRow) api.BoardState {
	b := api.BoardState{Board: board, Boot: r.boot, BootSeenAt: r.bootSeenAt, StateReceivedAt: r.receivedAt}
	if r.state != nil {
		b.State = json.RawMessage(r.state)
		if st, err := ParseState(r.state); err == nil && st.Protocol != "" {
			ok := ProtocolSupported(st.Protocol)
			b.ProtocolSupported = &ok
		}
	}
	return b
}

// History returns the stored values of one metric. A counter is returned as
// its rate (per second) unless the request says otherwise (wiki
// Mower-Protocol §16.3).
func (s *Service) History(ctx context.Context, req api.RequestMetricHistory) (api.MetricHistory, error) {
	id, ok := core.ParseDeviceID(req.Device)
	if !ok {
		return api.MetricHistory{}, apperr.NotFound("device not found")
	}
	if req.Board != api.BoardGateway && req.Board != api.BoardAutopilot {
		return api.MetricHistory{}, apperr.BadRequest("board must be gateway or autopilot")
	}
	if !ValidMetricName(req.Metric) {
		return api.MetricHistory{}, apperr.BadRequest("metric is not a valid metric name")
	}
	to := s.now()
	if req.To != nil {
		to = *req.To
	}
	from := to.Add(-defaultHistoryWindow)
	if req.From != nil {
		from = *req.From
	}
	if from.After(to) {
		return api.MetricHistory{}, apperr.BadRequest("from must not be after to")
	}
	limit := defaultHistoryPoints
	if req.Limit != nil {
		limit = *req.Limit
	}
	if limit < 1 || limit > maxHistoryPoints {
		return api.MetricHistory{}, apperr.BadRequest("limit must be 1 to %d", maxHistoryPoints)
	}
	if _, err := getDevice(ctx, s.pool, id); errors.Is(err, errNoDevice) {
		return api.MetricHistory{}, apperr.NotFound("device not found")
	} else if err != nil {
		return api.MetricHistory{}, apperr.DB(err)
	}
	kind := ""
	cats, err := loadCatalogues(ctx, s.pool, id)
	if err != nil {
		return api.MetricHistory{}, apperr.DB(err)
	}
	if cat, ok := cats[req.Board]; ok {
		if m, ok := FindMetric(cat, req.Metric); ok {
			kind = m.Kind
		}
	}
	rate := kind == "counter"
	if req.Rate != nil {
		rate = *req.Rate
	}
	samples, truncated, err := history(ctx, s.pool, id, req.Board, req.Metric, from, to, limit)
	if err != nil {
		return api.MetricHistory{}, apperr.DB(err)
	}
	if rate {
		samples = CounterRates(samples)
	}
	out := api.MetricHistory{
		Device: req.Device, Board: req.Board, Metric: req.Metric, MetricKind: kind, Rate: rate,
		Points: make([]api.MetricPoint, len(samples)), Truncated: truncated,
	}
	for i, p := range samples {
		out.Points[i] = api.MetricPoint{Time: p.Time, Boot: p.Boot, Value: p.Value}
	}
	return out, nil
}

// FindMetric looks a metric name up in a catalogue: an exact name, or a
// member of a family ("usage.mqtt.up.*" covers "usage.mqtt.up.autopilot/telemetry").
func FindMetric(cat api.BoardCatalogue, name string) (api.CatalogueMetric, bool) {
	for _, p := range cat.Parts {
		for _, m := range p.Metrics {
			if m.Name == name {
				return m, true
			}
		}
	}
	for _, p := range cat.Parts {
		for _, m := range p.Metrics {
			if prefix, ok := strings.CutSuffix(m.Name, "*"); ok && strings.HasSuffix(prefix, ".") {
				if rest, ok := strings.CutPrefix(name, prefix); ok && rest != "" && !strings.Contains(rest, ".") {
					return m, true
				}
			}
		}
	}
	return api.CatalogueMetric{}, false
}

// Events lists a device's newest events, newest first.
func (s *Service) Events(ctx context.Context, name string, limit int) (api.DeviceEventList, error) {
	id, ok := core.ParseDeviceID(name)
	if !ok {
		return api.DeviceEventList{}, apperr.NotFound("device not found")
	}
	if limit == 0 {
		limit = defaultEvents
	}
	if limit < 1 || limit > maxEvents {
		return api.DeviceEventList{}, apperr.BadRequest("limit must be 1 to %d", maxEvents)
	}
	if _, err := getDevice(ctx, s.pool, id); errors.Is(err, errNoDevice) {
		return api.DeviceEventList{}, apperr.NotFound("device not found")
	} else if err != nil {
		return api.DeviceEventList{}, apperr.DB(err)
	}
	events, err := listEvents(ctx, s.pool, id, limit)
	if err != nil {
		return api.DeviceEventList{}, apperr.DB(err)
	}
	if events == nil {
		events = []api.DeviceEvent{}
	}
	return api.DeviceEventList{Events: events}, nil
}
