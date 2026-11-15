package main

import (
	"encoding/json"
	"math"
	"time"
)

// The autopilot's clock tick: link, fix and faults, live driving, the path
// follower, recording, a simple motion and battery model, telemetry.

const (
	maxSpeed     = 0.6   // the autopilot's own maximum, m/s
	maxTurn      = 1.5   // rad/s
	trackWidth   = 0.4   // m between the wheels
	wheelCirc    = 0.628 // m
	reachRadius  = 0.12  // m: a path point is reached within this
	accelUp      = 1.5   // m/s²
	accelDown    = 4.0
	metresPerDeg = 111320.0
	capacityWh   = 150.0
	supplyV      = 25.0 // for the drain estimate
)

type pt2 struct{ x, y float64 }

type pathRun struct {
	kind       string // "follow" or "job"
	env        cmdEnv
	returnMode string
	reverse    bool
	speed      float64 // limit from the command or the file; 0 = none
	phase      string  // "download" or "drive"
	pts        []pt2
	bladeOn    []bool // blade while driving to point i
	segFirst   []bool // point i opens a segment
	idx        int    // the point being driven to
	reached    int    // the last point reached, -1 before the first

	jobID string
	size  int64
	sha   string
	from  int
}

type recPoint struct {
	lat, lon float64
	fix      int
}

type recSession struct {
	id       string
	spacing  float64
	taken    int
	pending  []recPoint
	lastX    float64
	lastY    float64
	haveLast bool
	contig   bool
	lastSend time.Time
}

func (a *autopilot) toLocal(lat, lon float64) (x, y float64) {
	return (lon - a.cfg.originLon) * metresPerDeg * math.Cos(a.cfg.originLat*math.Pi/180),
		(lat - a.cfg.originLat) * metresPerDeg
}

func (a *autopilot) toGeo(x, y float64) (lat, lon float64) {
	return a.cfg.originLat + y/metresPerDeg,
		a.cfg.originLon + x/(metresPerDeg*math.Cos(a.cfg.originLat*math.Pi/180))
}

func wrap180(d float64) float64 {
	d = math.Mod(d+180, 360)
	if d < 0 {
		d += 360
	}
	return d - 180
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func approach(cur, tgt, up, down, dt float64) float64 {
	rate := down
	if math.Abs(tgt) > math.Abs(cur) && cur*tgt >= 0 {
		rate = up
	}
	d := tgt - cur
	return cur + clamp(d, -rate*dt, rate*dt)
}

// ---- the tick ---------------------------------------------------------------------

func (a *autopilot) step(now time.Time) {
	dt := clamp(now.Sub(a.lastStep).Seconds(), 0, 0.5)
	a.lastStep = now
	if !a.restartAt.IsZero() {
		if now.Before(a.restartAt) {
			return
		}
		a.finishRestart(now)
		dt = 0
	}
	if a.lastHB.IsZero() || now.Sub(a.lastHB) >= time.Second {
		a.lastHB = now
		a.gw.apHeartbeat(now)
	}
	a.stepLink(now)
	a.stepFix(now)
	if a.mode != "fault" {
		if cause := a.faultCause(); cause != "" {
			a.enterFault(cause, now)
		}
	}
	a.stepBattery(now, dt)

	// Live driving: no valid setpoint for 0.5 s stops the machine (§9).
	if a.driving && now.Sub(a.lastDriveAt) >= driveTimeout {
		a.tgtV, a.tgtW, a.speed, a.omega = 0, 0, 0, 0
		a.blade, a.driving, a.haveSeq = false, false, false
		a.event("drive_timeout", nil)
	}
	a.stepPath(now)
	a.integrate(dt)
	a.stepRecording(now)

	if a.boardUp(now) {
		a.publishState(now) // a change while the link is down is held or retained for the server
	}
	if a.rawUp {
		a.confirmUpdate()
	}
	a.stepTelemetry(now)
	a.mon.step(now)
	a.jobDL.tick(now)
	a.fwDL.tick(now)
}

func (a *autopilot) finishRestart(now time.Time) {
	a.st.Boot++
	if a.confirm != nil && a.confirm.Rolled {
		a.st.Boot++
	}
	a.sv.save()
	a.startUp(now, a.bootReason)
}

// stepLink follows the server link of §4.2: up when the gateway says MQTT and
// the server are up and the board link works; lost after 10 s down.
func (a *autopilot) stepLink(now time.Time) {
	raw := a.boardUp(now) && a.gwMQTT && a.gwServer
	switch {
	case raw && !a.rawUp:
		a.rawUp, a.lost, a.downSince = true, false, time.Time{}
		a.lastState = ""
		a.publishCatalogue()
	case !raw && a.rawUp:
		a.rawUp, a.downSince = false, now
	}
	if !raw && !a.lost && !a.downSince.IsZero() && now.Sub(a.downSince) >= a.cfg.linkLost {
		a.lost = true
		a.onLinkLost(now)
	}
}

// onLinkLost is what the autopilot does when the server link is lost (§7.1).
func (a *autopilot) onLinkLost(now time.Time) {
	a.blade = false
	a.mon.endAll()
	switch a.mode {
	case "job":
		if a.paused == nil || *a.paused == "fix" {
			a.pause("link", now)
			a.event("job_paused", map[string]any{"reason": "link"})
		}
	case "recording":
		session := ""
		if a.rec != nil {
			session = a.rec.id
		}
		n := a.stopRecording(now, true)
		a.setMode("manual")
		a.event("recording_stopped", map[string]any{"reason": "link", "session": session, "index": n})
	}
}

// stepFix raises the fix events and pauses or continues a path (§7.1).
func (a *autopilot) stepFix(now time.Time) {
	rtk := a.fixLevel() == 4
	switch {
	case a.prevRTK && !rtk:
		a.event("fix_lost", map[string]any{"fix": fixNames[a.fixLevel()]})
	case !a.prevRTK && rtk:
		a.event("fix_regained", map[string]any{"fix": "rtk_fixed"})
	}
	a.prevRTK = rtk
	if a.mode != "job" || a.path == nil {
		return
	}
	switch {
	case rtk:
		a.fixLostAt = time.Time{}
		if a.paused != nil && *a.paused == "fix" {
			a.unpause(now)
			a.event("job_resumed", map[string]any{"reason": "fix"})
		}
	case a.paused == nil:
		if a.fixLostAt.IsZero() {
			a.fixLostAt = now
		}
		if now.Sub(a.fixLostAt) >= a.cfg.fixGrace {
			a.pause("fix", now)
			a.event("job_paused", map[string]any{"reason": "fix"})
		}
	}
}

func (a *autopilot) stepBattery(now time.Time, dt float64) {
	power := a.current() * a.voltage()
	a.battery = clamp(a.battery-power*dt/(capacityWh*3600)*100, 0, 100)
	if a.battery <= batteryWarn && !a.batteryWarned {
		a.batteryWarned = true
		a.event("battery_low", map[string]any{"v": roundTo(a.voltage(), 2)})
	}
	if a.battery > batteryWarn+5 {
		a.batteryWarned = false
	}
}

func (a *autopilot) current() float64 {
	c := 0.6 + 5*math.Abs(a.speed)/maxSpeed + 2.5*math.Abs(a.omega)/maxTurn
	if a.blade {
		c += 3.8
	}
	return c
}

func (a *autopilot) voltage() float64 {
	return 21 + 8.4*a.battery/100 - a.current()*0.06
}

// ---- the path follower ------------------------------------------------------------

func (a *autopilot) stepPath(now time.Time) {
	p := a.path
	if p == nil || a.mode != "job" {
		return
	}
	if p.phase != "drive" || a.paused != nil {
		a.tgtV, a.tgtW, a.blade = 0, 0, false
		return
	}
	for p.idx < len(p.pts) {
		t := p.pts[p.idx]
		if math.Hypot(t.x-a.x, t.y-a.y) >= reachRadius {
			break
		}
		p.reached = p.idx
		p.idx++
	}
	if p.idx >= len(p.pts) {
		var result any = map[string]any{}
		if p.kind == "job" {
			result = map[string]any{"points": len(p.pts)}
		}
		if p.kind == "job" {
			a.sendJobPoint(now) // the server sees the last point before the job ends
		}
		a.endPath("", "", result, now)
		return
	}
	t := p.pts[p.idx]
	dx, dy := t.x-a.x, t.y-a.y
	dist := math.Hypot(dx, dy)
	bearing := math.Atan2(dx, dy) * 180 / math.Pi
	h := a.heading
	if p.reverse {
		h += 180
	}
	errDeg := wrap180(bearing - h)
	vmax := maxSpeed
	if p.speed > 0 {
		vmax = math.Min(vmax, p.speed)
	}
	w := clamp(-errDeg*math.Pi/180*1.8, -1.2, 1.2)
	v := 0.0
	if math.Abs(errDeg) < 30 {
		v = vmax * clamp(dist/0.5, 0.3, 1)
	}
	if p.reverse {
		v = -v
	}
	a.tgtV, a.tgtW = v, w
	a.blade = p.bladeOn[p.idx] // back to the segment's blade state after any pause
}

// ---- the machine ------------------------------------------------------------------

func (a *autopilot) integrate(dt float64) {
	moving := a.mode == "manual" || a.mode == "recording" ||
		(a.mode == "job" && a.path != nil && a.path.phase == "drive" && a.paused == nil)
	if !moving {
		a.speed, a.omega, a.tgtV, a.tgtW = 0, 0, 0, 0
		if a.mode != "job" && a.mode != "manual" && a.mode != "recording" {
			a.blade = false
		}
	} else {
		a.speed = approach(a.speed, a.tgtV, accelUp, accelDown, dt)
		a.omega = approach(a.omega, a.tgtW, 6, 6, dt)
	}
	a.heading = math.Mod(a.heading-a.omega*dt*180/math.Pi+720, 360)
	rad := a.heading * math.Pi / 180
	a.x += a.speed * math.Sin(rad) * dt
	a.y += a.speed * math.Cos(rad) * dt
	a.vl = a.speed - a.omega*trackWidth/2
	a.vr = a.speed + a.omega*trackWidth/2
	target := 0.0
	if a.blade {
		target = 2900
	}
	a.bladeRPM = approach(a.bladeRPM, target, 3000, 3000, dt)
}

// ---- recording --------------------------------------------------------------------

// stepRecording takes a point each time the machine has moved `spacing`, while
// the fix is float or fixed, and publishes them in batches (§10).
func (a *autopilot) stepRecording(now time.Time) {
	r := a.rec
	if r == nil || a.mode != "recording" {
		return
	}
	if a.fixLevel() < 3 {
		r.contig = false
		return
	}
	take := func(x, y float64) {
		lat, lon := a.toGeo(x, y)
		r.pending = append(r.pending, recPoint{roundTo(lat, 8), roundTo(lon, 8), a.fixLevel()})
		r.taken++
		r.lastX, r.lastY, r.haveLast = x, y, true
	}
	switch {
	case !r.haveLast:
		take(a.x, a.y)
	default:
		d := math.Hypot(a.x-r.lastX, a.y-r.lastY)
		if !r.contig {
			if d >= r.spacing {
				take(a.x, a.y)
			}
		} else {
			for d >= r.spacing {
				ux, uy := (a.x-r.lastX)/d, (a.y-r.lastY)/d
				take(r.lastX+ux*r.spacing, r.lastY+uy*r.spacing)
				d = math.Hypot(a.x-r.lastX, a.y-r.lastY)
			}
		}
	}
	r.contig = true
	if len(r.pending) > 0 && now.Sub(r.lastSend) >= time.Second {
		a.sendPoints(now, 50)
		r.lastSend = now
	}
}

// sendPoints publishes up to max pending points as one batch.
func (a *autopilot) sendPoints(now time.Time, max int) {
	r := a.rec
	n := min(max, len(r.pending))
	batch := r.pending[:n]
	r.pending = r.pending[n:]
	worst := 4
	pts := make([][2]float64, n)
	for i, p := range batch {
		worst = min(worst, p.fix)
		pts[i] = [2]float64{p.lat, p.lon}
	}
	msg, _ := json.Marshal(map[string]any{"session": r.id, "index": r.taken - len(r.pending) - n, "fix": fixNames[worst],
		"time": a.timeOrNil(now), "points": pts})
	a.out("recording", 1, false, msg)
}

// stopRecording ends the session, publishes what it still holds and returns
// the number of points taken.
func (a *autopilot) stopRecording(now time.Time, flush bool) int {
	r := a.rec
	if r == nil {
		return 0
	}
	for flush && len(r.pending) > 0 {
		a.sendPoints(now, 50)
	}
	a.rec = nil
	return r.taken
}

// ---- telemetry --------------------------------------------------------------------

func (a *autopilot) stepTelemetry(now time.Time) {
	metrics := map[string]any{}
	for _, d := range a.defs {
		period := d.Period
		if a.mode == "idle" && period < 10 {
			period = 10 // §7.2: in idle every period is at least 10 s
		}
		last := a.tele[d.Name]
		if last.IsZero() || now.Sub(last) >= time.Duration(period*float64(time.Second))-50*time.Millisecond {
			metrics[d.Name] = a.value(d.Name)
			a.tele[d.Name] = now
		}
	}
	if len(metrics) == 0 || !a.boardUp(now) {
		return
	}
	payload, _ := json.Marshal(map[string]any{"time": a.timeOrNil(now), "boot": a.st.Boot, "metrics": metrics})
	a.out("telemetry", 0, false, payload)
}

// sendJobPoint publishes a telemetry message with the current job.point at
// once, outside the metric's period.
func (a *autopilot) sendJobPoint(now time.Time) {
	a.tele["job.point"] = now
	payload, _ := json.Marshal(map[string]any{"time": a.timeOrNil(now), "boot": a.st.Boot,
		"metrics": map[string]any{"job.point": a.value("job.point")}})
	a.out("telemetry", 0, false, payload)
}

var satsByFix = []int{3, 9, 13, 19, 24}
var accuracyByFix = []float64{0, 2.5, 0.8, 0.18, 0.014}

func (a *autopilot) uptime() float64 { return a.cfg.clock().Sub(a.startedAt).Seconds() }

// value is a metric's value now; nil when unknown.
func (a *autopilot) value(name string) any {
	up := a.uptime()
	fix := a.fixLevel()
	switch name {
	case "position.lat", "position.lon":
		if fix == 0 {
			return nil
		}
		lat, lon := a.toGeo(a.x, a.y)
		if name == "position.lat" {
			return roundTo(lat, 8)
		}
		return roundTo(lon, 8)
	case "position.heading":
		if fix == 0 || math.Abs(a.speed) < 0.03 {
			return nil // one antenna: the heading comes from movement
		}
		h := a.heading
		if a.speed < 0 {
			h = math.Mod(h+180, 360)
		}
		return roundTo(h, 1)
	case "position.alt":
		if fix == 0 {
			return nil
		}
		return roundTo(112.4+wobble(up, 300, 0.05), 2)
	case "position.speed":
		return roundTo(math.Abs(a.speed), 2)
	case "gnss.fix":
		return fix
	case "gnss.sats":
		return satsByFix[fix]
	case "gnss.accuracy":
		if fix == 0 {
			return nil
		}
		return accuracyByFix[fix]
	case "gnss.correction_age":
		if fix < 2 {
			return nil
		}
		return roundTo(1.0+0.4*math.Sin(up/3), 1)
	case "job.point":
		if a.path != nil && a.path.kind == "job" && a.path.reached >= 0 {
			return a.path.reached
		}
		return nil
	case "battery.v":
		return roundTo(a.voltage(), 2)
	case "battery.a":
		return roundTo(a.current(), 2)
	case "battery.power":
		return roundTo(a.current()*a.voltage(), 1)
	case "battery.pct":
		return int(math.Round(a.battery))
	case "drive.left.speed":
		return roundTo(a.vl, 2)
	case "drive.right.speed":
		return roundTo(a.vr, 2)
	case "drive.left.rpm":
		return int(math.Round(a.vl / wheelCirc * 60))
	case "drive.right.rpm":
		return int(math.Round(a.vr / wheelCirc * 60))
	case "blade.on":
		return a.blade
	case "blade.rpm":
		return int(math.Round(a.bladeRPM))
	case "system.psram.free":
		return int(6_200_000 + wobble(up, 200, 20000))
	case "system.psram.pct":
		return int(math.Round(25 + wobble(up, 200, 0.5)))
	case "system.cpu":
		return int(math.Round(22 + math.Abs(a.speed)*20 + wobble(up, 31, 4)))
	case "system.core0":
		return int(math.Round(26 + wobble(up, 29, 5)))
	case "system.core1":
		return int(math.Round(18 + wobble(up, 37, 4)))
	case "system.memory.free":
		return int(231000 + wobble(up, 150, 2500))
	case "system.memory.min_free":
		return 198000
	case "system.memory.largest":
		return 114688
	case "system.memory.pct":
		return int(math.Round(48 - wobble(up, 150, 1)))
	case "system.nvs.pct":
		return 12
	case "system.temperature":
		return roundTo(41+math.Abs(a.speed)*8+wobble(up, 240, 1.5), 1)
	case "link.crc_errors":
		return 0
	case "link.dropped":
		return a.dropped
	}
	return nil
}
