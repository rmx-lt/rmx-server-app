package mower

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/core"
)

// Corrections (wiki Mower-Protocol §13). The NTRIP client runs on the
// gateway and keeps its settings across restarts, so the server sends them
// once per gateway (ntrip_set) and again when they change. The settings come
// from the server's environment (NTRIP_*, see config.NTRIP): the password is a
// secret like the MQTT password, so it is never written to the database, the
// log or the API. What the server stores per gateway is a keyed fingerprint of
// what the gateway acknowledged, which cannot be turned back into the password.
//
// The server decides when to send from the gateway's retained state, which
// arrives whenever the gateway's link to the server comes up: no fingerprint
// stored, a different one, or the gateway reporting ntrip "off" (it lost its
// settings) means send. Settings that were removed from the server's
// environment send ntrip_clear to a gateway that has them.

// ntripRetry is how long after sending (or failing to send) the server waits
// before it tries again for the same gateway.
const ntripRetry = 30 * time.Second

type ntripSync struct {
	cfg config.NTRIP
	key []byte

	mu      sync.Mutex
	lastTry map[core.DeviceID]time.Time
}

// SetNTRIP sets the caster settings the service sends to gateways. key keys
// the fingerprint kept in the database (the MQTT password will do: it is a
// secret the server already has).
func (s *Service) SetNTRIP(cfg config.NTRIP, key string) {
	s.ntrip = &ntripSync{cfg: cfg, key: []byte(key), lastTry: map[core.DeviceID]time.Time{}}
}

// NTRIP returns the settings without the password.
func (s *Service) NTRIP() api.NtripSettings {
	if s.ntrip == nil || !s.ntrip.cfg.Configured() {
		return api.NtripSettings{}
	}
	c := s.ntrip.cfg
	return api.NtripSettings{
		Configured: true, Host: c.Host, Port: int(c.Port), Mountpoint: c.Mountpoint, User: c.User,
		PasswordSet: c.Password != "",
	}
}

// fingerprint identifies the settings: a keyed hash over all fields, password included.
func (n *ntripSync) fingerprint() string {
	h := hmac.New(sha256.New, n.key)
	for _, f := range []string{n.cfg.Host, strconv.Itoa(int(n.cfg.Port)), n.cfg.Mountpoint, n.cfg.User, n.cfg.Password} {
		h.Write([]byte(strconv.Itoa(len(f)) + ":" + f))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// syncNTRIP looks at a gateway's state and sends the caster settings when
// they are due. state is the parsed gateway state.
func (s *Service) syncNTRIP(ctx context.Context, device core.DeviceID, st State) {
	n := s.ntrip
	if n == nil || s.pub == nil {
		return
	}
	// A gateway whose protocol the server does not support gets nothing but ota (§2).
	if st.Protocol != "" && !ProtocolSupported(st.Protocol) {
		return
	}
	sent, err := ntripFingerprint(ctx, s.pool, device)
	if err != nil {
		slog.Error("reading the NTRIP fingerprint failed", "device", string(device), "error", err)
		return
	}
	now := s.now()
	if !n.cfg.Configured() {
		if sent == "" {
			return
		}
		if !n.due(device, now) {
			return
		}
		s.sendNTRIP(ctx, device, "ntrip_clear", nil, nil, func(a Ack) {
			if a.State == "done" {
				if err := deleteNtripFingerprint(s.runCtx(), s.pool, device); err != nil {
					slog.Error("forgetting the NTRIP fingerprint failed", "device", string(device), "error", err)
				}
			}
		})
		return
	}
	fp := n.fingerprint()
	if sent == fp && st.NTRIP != "off" {
		return
	}
	if !n.due(device, now) {
		return
	}
	raw := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	s.sendNTRIP(ctx, device, "ntrip_set",
		map[string]json.RawMessage{
			"host": raw(n.cfg.Host), "port": raw(n.cfg.Port), "mountpoint": raw(n.cfg.Mountpoint), "user": raw(n.cfg.User),
		},
		map[string]json.RawMessage{"password": raw(n.cfg.Password)},
		func(a Ack) {
			if a.State != "done" {
				if a.State == "failed" {
					slog.Warn("a gateway did not take the NTRIP settings", "device", string(device), "error", a.Error)
				}
				return
			}
			if err := saveNtripFingerprint(s.runCtx(), s.pool, device, fp, s.now()); err != nil {
				slog.Error("storing the NTRIP fingerprint failed", "device", string(device), "error", err)
			}
		})
}

// due reports whether the server may try for device now, and notes the try.
func (n *ntripSync) due(device core.DeviceID, now time.Time) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if last, ok := n.lastTry[device]; ok && now.Sub(last) < ntripRetry {
		return false
	}
	n.lastTry[device] = now
	return true
}

func (s *Service) sendNTRIP(ctx context.Context, device core.DeviceID, cmd string, params, secret map[string]json.RawMessage, hook func(Ack)) {
	if _, err := s.dispatch(ctx, outgoing{
		device: device, board: api.BoardGateway, cmd: cmd, params: params, secret: secret,
		persist: true, hook: hook,
	}); err != nil {
		slog.Error("sending the NTRIP settings failed", "device", string(device), "cmd", cmd, "error", err)
	}
}
