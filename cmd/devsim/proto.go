package main

import (
	"encoding/json"
	"math"
	"regexp"
	"sync/atomic"
	"time"
)

// Shared pieces of the simulated mower, written from wiki Mower-Protocol (the
// contract): ids, time, the command envelope, acks and the 2-minute id memory.

const protocolVersion = "0.1"

// sink takes one message to publish. topic is relative to <prefix>/<name>/
// (for example "gateway/state"); it must not block.
type sink func(topic string, qos byte, retain bool, payload []byte)

var idRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func validID(s string) bool { return idRe.MatchString(s) }

// tf is a Unix time in seconds with millisecond precision (§4.1).
func tf(t time.Time) float64 { return math.Round(float64(t.UnixNano())/1e6) / 1e3 }

func roundTo(f float64, decimals int) float64 {
	p := math.Pow(10, float64(decimals))
	return math.Round(f*p) / p
}

// cmdEnv is a parsed command (§5): the envelope plus the raw parameters.
type cmdEnv struct {
	id, cmd string
	raw     map[string]json.RawMessage
}

func (e cmdEnv) str(key string) (string, bool) {
	var s string
	r, ok := e.raw[key]
	if !ok || json.Unmarshal(r, &s) != nil {
		return "", false
	}
	return s, true
}

func (e cmdEnv) num(key string) (float64, bool) {
	var f float64
	r, ok := e.raw[key]
	if !ok || json.Unmarshal(r, &f) != nil {
		return 0, false
	}
	return f, true
}

func (e cmdEnv) boolean(key string) (bool, bool) {
	var b bool
	r, ok := e.raw[key]
	if !ok || json.Unmarshal(r, &b) != nil {
		return false, false
	}
	return b, true
}

func (e cmdEnv) has(key string) bool {
	r, ok := e.raw[key]
	return ok && string(r) != "null"
}

// ack is a message on <board>/cmd/ack (§5).
type ack struct {
	ID      string   `json:"id"`
	Cmd     string   `json:"cmd"`
	OK      bool     `json:"ok"`
	State   string   `json:"state"`
	Result  any      `json:"result,omitempty"`
	Error   string   `json:"error,omitempty"`
	Message string   `json:"message,omitempty"`
	Time    *float64 `json:"time"`
}

type memEntry struct {
	last  []byte
	final bool
	at    time.Time
}

// receiver is what both boards share for commands: parsing, the checks of §5,
// the memory of command ids and the acks.
type receiver struct {
	ttl      time.Duration
	now      func() time.Time
	clockSet func() bool
	publish  func(payload []byte) // the board's cmd/ack topic
	dropAcks *atomic.Int64        // switch: acks that are not sent
	mem      map[string]*memEntry
	onDrop   func(a ack)
}

func newReceiver(ttl time.Duration, now func() time.Time, clockSet func() bool, drop *atomic.Int64) *receiver {
	return &receiver{ttl: ttl, now: now, clockSet: clockSet, dropAcks: drop, mem: map[string]*memEntry{}}
}

// reset forgets every id, as after a restart.
func (r *receiver) reset() { r.mem = map[string]*memEntry{} }

func (r *receiver) prune() {
	now := r.now()
	for id, e := range r.mem {
		if e.final && now.Sub(e.at) > r.ttl {
			delete(r.mem, id)
		}
	}
}

// accept parses a command and runs the checks every command gets. ok is true
// when the board should execute env; otherwise the ack (a refusal, or the
// remembered one for a repeated id) has been sent.
func (r *receiver) accept(payload []byte) (env cmdEnv, ok bool) {
	r.prune()
	var raw map[string]json.RawMessage
	if json.Unmarshal(payload, &raw) != nil || raw == nil {
		r.send(cmdEnv{}, "failed", false, nil, "bad_request", "not a JSON object")
		return env, false
	}
	env = cmdEnv{raw: raw}
	env.id, _ = env.str("id")
	env.cmd, _ = env.str("cmd")
	if !validID(env.id) || env.cmd == "" {
		env = cmdEnv{id: env.id, cmd: env.cmd}
		if !validID(env.id) {
			env.id = ""
		}
		r.send(env, "failed", false, nil, "bad_request", `need "id" (1-64 characters of A-Za-z0-9_-) and "cmd"`)
		return env, false
	}
	if e, dup := r.mem[env.id]; dup {
		r.publishAck(e.last, ack{ID: env.id, Cmd: env.cmd})
		return env, false
	}
	if env.has("expires_at") {
		exp, isNum := env.num("expires_at")
		switch {
		case !isNum:
			r.send(env, "failed", false, nil, "bad_request", "expires_at must be a Unix time in seconds")
			return env, false
		case !r.clockSet():
			r.send(env, "failed", false, nil, "no_clock", "expires_at is set and the clock is not")
			return env, false
		case exp < float64(r.now().Unix()):
			r.send(env, "failed", false, nil, "expired", "the command expired before it arrived")
			return env, false
		}
	}
	return env, true
}

// send builds an ack, remembers it as the last one for the id and publishes it.
func (r *receiver) send(env cmdEnv, state string, ok bool, result any, code, message string) {
	a := ack{ID: env.id, Cmd: env.cmd, OK: ok, State: state, Result: result, Error: code, Message: message}
	if r.clockSet() {
		t := tf(r.now())
		a.Time = &t
	}
	payload, _ := json.Marshal(a)
	if env.id != "" {
		r.mem[env.id] = &memEntry{last: payload, final: state != "accepted", at: r.now()}
	}
	r.publishAck(payload, a)
}

func (r *receiver) publishAck(payload []byte, a ack) {
	if r.dropAcks != nil {
		for {
			n := r.dropAcks.Load()
			if n <= 0 {
				break
			}
			if r.dropAcks.CompareAndSwap(n, n-1) {
				if r.onDrop != nil {
					r.onDrop(a)
				}
				return
			}
		}
	}
	r.publish(payload)
}

func (r *receiver) accepted(env cmdEnv)               { r.send(env, "accepted", true, nil, "", "") }
func (r *receiver) done(env cmdEnv, result any)       { r.send(env, "done", true, result, "", "") }
func (r *receiver) fail(env cmdEnv, code, msg string) { r.send(env, "failed", false, nil, code, msg) }

// mqttPacketSize is the size of an MQTT 5 PUBLISH on the wire: fixed header,
// topic, packet id (QoS 1), properties length and the payload.
func mqttPacketSize(topic string, payloadLen int, qos byte) int {
	rem := 2 + len(topic) + 1 + payloadLen
	if qos > 0 {
		rem += 2
	}
	n := 1
	for v := rem; ; v /= 128 {
		n++
		if v < 128 {
			break
		}
	}
	return n + rem
}
