package mower

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"sync"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/apperr"
	"github.com/rmx-lt/rmx-server-app/internal/core"
)

// Live driving (wiki Mower-Protocol §9). The browser sends its setpoint over
// the WebSocket as often as it likes; the server publishes the latest one on
// autopilot/drive about 10 times per second (QoS 0, no acks) with a counter
// and its own clock, for as long as the browser keeps sending. When the
// browser stops (closed tab, lost connection), the server stops, and the
// autopilot stops the motors after 0.5 s without a setpoint.

const (
	// driveInterval is the time between two published setpoints.
	driveInterval = 100 * time.Millisecond
	// driveFresh is how old the browser's last setpoint may be and still be
	// published: three intervals. Older, and the server falls silent.
	driveFresh = 3 * driveInterval
)

type driveState struct {
	v, w    float64
	last    time.Time
	running bool
}

type driving struct {
	mu   sync.Mutex
	devs map[core.DeviceID]*driveState
	seq  int64
}

func (d *driving) init() { d.devs = map[core.DeviceID]*driveState{} }

// Setpoint is the message on autopilot/drive (§9).
type Setpoint struct {
	Seq  int64   `json:"seq"`
	Time float64 `json:"time"`
	V    float64 `json:"v"`
	W    float64 `json:"w"`
}

// step is one tick of a device's drive loop: the setpoint to publish, or
// false when the browser has gone quiet and the loop ends.
func (d *driving) step(device core.DeviceID, now time.Time) (Setpoint, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	st := d.devs[device]
	if st == nil || now.Sub(st.last) > driveFresh {
		if st != nil {
			st.running = false
		}
		return Setpoint{}, false
	}
	d.seq++
	return Setpoint{Seq: d.seq, Time: float64(now.UnixMilli()) / 1000, V: st.v, W: st.w}, true
}

// Drive takes the browser's setpoint. It starts the publishing loop of the
// device when none runs, and returns at once.
func (s *Service) Drive(ctx context.Context, req api.RequestDrive) error {
	device, ok := core.ParseDeviceID(req.Device)
	if !ok {
		return apperr.NotFound("device not found")
	}
	if !finite(req.V) || !finite(req.W) {
		return apperr.BadRequest("v and w must be finite numbers")
	}
	if s.pub == nil {
		return apperr.Internal(errors.New("driving is not connected to MQTT"))
	}
	now := s.now()
	s.drv.mu.Lock()
	st := s.drv.devs[device]
	start := st == nil || !st.running
	if st == nil {
		st = &driveState{}
		s.drv.devs[device] = st
	}
	st.v, st.w, st.last = req.V, req.W, now
	known := !start // a loop is running, so the device was checked when it began
	if start {
		st.running = true
	}
	s.drv.mu.Unlock()
	if known {
		return nil
	}

	// The first setpoint of a drive: check the device exists, then run the loop.
	if _, err := getDevice(ctx, s.pool, device); err != nil {
		s.drv.mu.Lock()
		st.running = false
		s.drv.mu.Unlock()
		if errors.Is(err, errNoDevice) {
			return apperr.NotFound("device not found")
		}
		return apperr.DB(err)
	}
	go s.driveLoop(device)
	return nil
}

func finite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

func (s *Service) driveLoop(device core.DeviceID) {
	ctx := s.runCtx()
	tick := time.NewTicker(driveInterval)
	defer tick.Stop()
	for {
		sp, ok := s.drv.step(device, s.now())
		if !ok {
			return
		}
		body, err := json.Marshal(sp)
		if err == nil {
			err = s.pub.PublishFast(ctx, device, DriveTopic, body)
		}
		if err != nil && ctx.Err() == nil {
			slog.Warn("publishing a setpoint failed", "device", string(device), "error", err)
		}
		select {
		case <-tick.C:
		case <-ctx.Done():
			return
		}
	}
}
