package main

import (
	"encoding/json"
	"slices"
	"strings"
	"time"
)

// Monitor streams (wiki Mower-Protocol §15), the same on both boards: fast
// samples of chosen metrics, a budget of values per second, kept alive by
// repeating monitor_start.

const (
	monitorEmit = 200 * time.Millisecond
	defaultHold = 10
	maxHold     = 60
)

type stream struct {
	session string
	metrics []string
	rate    int
	until   time.Time

	index    int // samples taken so far
	nextAt   time.Time
	pending  [][]any
	firstIdx int
	firstAt  time.Time
	emitAt   time.Time
}

type monitor struct {
	budget  int
	publish func(payload []byte) // <board>/monitor
	// rates says whether name is a metric of the board's catalogue and which
	// monitor rates it offers; value reads it now.
	rates func(name string) (rates []int, ok bool)
	value func(name string) any

	streams map[string]*stream
	order   []string
}

func newMonitor(budget int, publish func([]byte), rates func(string) ([]int, bool), value func(string) any) *monitor {
	return &monitor{budget: budget, publish: publish, rates: rates, value: value, streams: map[string]*stream{}}
}

func (m *monitor) used() int {
	n := 0
	for _, s := range m.streams {
		n += len(s.metrics) * s.rate
	}
	return n
}

func (m *monitor) result() map[string]any {
	return map[string]any{"budget": m.budget, "used": m.used()}
}

// start handles monitor_start. It returns the error code and message, or ""
// when the stream runs; the result (budget and used) goes on every ack.
func (m *monitor) start(env cmdEnv, now time.Time) (code, msg string) {
	session, ok := env.str("session")
	if !ok || !validID(session) {
		return "bad_request", "session must be an id"
	}
	var metrics []string
	if raw, has := env.raw["metrics"]; !has || json.Unmarshal(raw, &metrics) != nil || len(metrics) == 0 {
		return "bad_request", "metrics must be a list of metric names"
	}
	rate, ok := env.num("rate")
	if !ok || rate != float64(int(rate)) || rate < 1 {
		return "bad_request", "rate must be a whole number of samples per second"
	}
	hold := float64(defaultHold)
	if env.has("hold") {
		if hold, ok = env.num("hold"); !ok || hold <= 0 || hold > maxHold {
			return "bad_request", "hold must be 1-60 seconds"
		}
	}
	for _, name := range metrics {
		if strings.HasSuffix(name, "*") {
			return "bad_request", "name a family member in full, not " + name
		}
		rates, known := m.rates(name)
		if !known {
			return "bad_request", "unknown metric " + name
		}
		if !slices.Contains(rates, int(rate)) {
			return "bad_request", "the rate is not offered by " + name
		}
	}
	if s, running := m.streams[session]; running {
		if !slices.Equal(s.metrics, metrics) || s.rate != int(rate) {
			return "bad_request", "session " + session + " runs with other metrics or rate"
		}
		s.until = now.Add(time.Duration(hold * float64(time.Second)))
		return "", ""
	}
	if m.used()+len(metrics)*int(rate) > m.budget {
		return "over_budget", "the stream does not fit the budget"
	}
	m.streams[session] = &stream{session: session, metrics: metrics, rate: int(rate), nextAt: now,
		until: now.Add(time.Duration(hold * float64(time.Second))), emitAt: now.Add(monitorEmit)}
	m.order = append(m.order, session)
	return "", ""
}

// stop handles monitor_stop; an empty session stops every stream.
func (m *monitor) stop(session string) {
	for _, s := range slices.Clone(m.order) {
		if session == "" || s == session {
			m.end(s)
		}
	}
}

func (m *monitor) end(session string) {
	if s, ok := m.streams[session]; ok {
		m.flush(s)
	}
	delete(m.streams, session)
	m.order = slices.DeleteFunc(m.order, func(s string) bool { return s == session })
}

func (m *monitor) endAll() { m.stop("") }

func (m *monitor) flush(s *stream) {
	if len(s.pending) == 0 {
		return
	}
	msg, _ := json.Marshal(map[string]any{"session": s.session, "index": s.firstIdx, "time": tf(s.firstAt),
		"rate": s.rate, "metrics": s.metrics, "samples": s.pending})
	m.publish(msg)
	s.pending = nil
}

// step takes the samples that are due and publishes a message per stream every
// 0.2 s (or every sample when they are further apart than that).
func (m *monitor) step(now time.Time) {
	for _, id := range slices.Clone(m.order) {
		s := m.streams[id]
		if now.After(s.until) {
			m.end(id)
			continue
		}
		interval := time.Second / time.Duration(s.rate)
		for !s.nextAt.After(now) {
			vals := make([]any, len(s.metrics))
			for i, name := range s.metrics {
				vals[i] = m.value(name)
			}
			if len(s.pending) == 0 {
				s.firstIdx, s.firstAt = s.index, s.nextAt
			}
			s.pending = append(s.pending, vals)
			s.index++
			s.nextAt = s.nextAt.Add(interval)
		}
		if len(s.pending) > 0 && (interval >= monitorEmit || !now.Before(s.emitAt)) {
			m.flush(s)
			s.emitAt = now.Add(monitorEmit)
		}
	}
}
