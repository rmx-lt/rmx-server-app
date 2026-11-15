package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"regexp"
	"slices"
	"time"
)

// The simulated autopilot (wiki Mower-Protocol §7 to §11): the state machine of
// §8, events, live driving, recording and jobs. The motion model is in
// motion.go. Everything runs from step(now), so tests drive it with a fake
// clock.

var faultCodes = []string{"motor_stall", "blade_stall", "battery_low", "internal"}

var faultMessages = map[string]string{
	"motor_stall": "A wheel does not turn",
	"blade_stall": "The blade does not turn",
	"battery_low": "The battery is below its critical level",
	"internal":    "Internal error",
}

type faultInfo struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type apState struct {
	Protocol  string     `json:"protocol"`
	Boot      int        `json:"boot"`
	Firmware  string     `json:"firmware"`
	Previous  *string    `json:"previous"`
	Partition string     `json:"partition"`
	Mode      string     `json:"mode"`
	Paused    *string    `json:"paused"`
	Job       *string    `json:"job"`
	Recording *string    `json:"recording"`
	Fault     *faultInfo `json:"fault"`
	Time      *float64   `json:"time"`
}

const (
	driveTimeout  = 500 * time.Millisecond
	driveMaxAge   = time.Second
	batteryWarn   = 15.0
	batteryCrit   = 8.0
	heartbeatDead = 3 * time.Second
)

var sha256Re = regexp.MustCompile(`^[0-9a-f]{64}$`)

// cmdModes is the "Allowed in" column of §8; no entry means any mode.
var cmdModes = map[string][]string{
	"manual_start": {"idle"},
	"manual_stop":  {"manual"},
	"blade":        {"manual", "recording"},
	"follow":       {"idle", "manual"},
	"record_start": {"idle", "manual"},
	"record_stop":  {"recording"},
	"job_start":    {"idle"},
	"pause":        {"job"},
	"resume":       {"job"},
	"clear_fault":  {"fault"},
	"ota":          {"idle"},
	"restart":      {"idle", "fault"},
}

var autopilotCmds = []string{"stop", "manual_start", "manual_stop", "blade", "follow", "record_start", "record_stop",
	"job_start", "pause", "resume", "clear_fault", "monitor_start", "monitor_stop", "ota", "restart"}

type autopilot struct {
	cfg simConfig
	sw  *switches
	sv  *store
	st  *boardStore
	gw  *gateway

	version string
	recv    *receiver
	mon     *monitor
	jobDL   *downloader
	fwDL    *downloader
	defs    []metricDef
	cat     catalogue

	// state (§7.1)
	mode      string
	paused    *string
	job       *string
	recording *string
	fault     *faultInfo
	seq       int
	lastState string

	// the board link and the server link (§4.2, §14.4)
	startedAt  time.Time
	hbSeen     bool
	lastGWHB   time.Time
	lastHB     time.Time
	gwMQTT     bool
	gwServer   bool
	clockSet   bool
	rawUp      bool
	lost       bool
	downSince  time.Time
	dropped    uint64
	restartAt  time.Time
	bootReason string
	confirm    *pendingOTA

	// live driving (§9)
	haveSeq     bool
	lastSeq     float64
	driving     bool
	lastDriveAt time.Time
	tgtV, tgtW  float64

	// the machine
	x, y, heading  float64 // metres east, north of the origin; degrees clockwise from north
	speed, omega   float64 // m/s forward, rad/s left
	vl, vr         float64
	blade          bool
	bladeRPM       float64
	battery        float64 // percent
	lastStep       time.Time
	bladeLatchStop bool

	// fix and faults
	prevRTK       bool
	fixLostAt     time.Time
	batteryWarned bool

	long *longCmd // the running long-running command
	path *pathRun
	rec  *recSession
	ota  *otaRun

	tele map[string]time.Time
}

type longCmd struct{ env cmdEnv }

func newAutopilot(cfg simConfig, sw *switches, sv *store, gw *gateway) *autopilot {
	a := &autopilot{cfg: cfg, sw: sw, sv: sv, st: &sv.data.Autopilot, gw: gw, battery: 92, heading: 90}
	a.version = a.st.version(cfg.apVersion)
	a.defs = autopilotDefs()
	a.cat = buildCatalogue(a.defs, 1)
	a.recv = newReceiver(cfg.cmdMemory, cfg.clock, func() bool { return a.clockSet }, &sw.dropAcks)
	a.recv.publish = func(p []byte) { a.out("cmd/ack", 1, false, p) }
	a.mon = newMonitor(400, func(p []byte) { a.out("monitor", 0, false, p) }, a.monRates, a.value)
	a.jobDL = newDownloader(func(p []byte) { a.out("job/req", 1, false, p) })
	a.fwDL = newDownloader(func(p []byte) { a.out("fw/req", 1, false, p) })
	a.jobDL.timeout, a.fwDL.timeout = cfg.dlTimeout, cfg.dlTimeout
	a.confirm = a.st.PendingOTA
	a.startUp(cfg.clock(), "power_on")
	return a
}

// startUp is a boot: everything volatile starts again.
func (a *autopilot) startUp(now time.Time, reason string) {
	a.startedAt, a.lastStep, a.lastHB = now, now, time.Time{}
	a.mode, a.paused, a.job, a.recording, a.fault = "idle", nil, nil, nil, nil
	a.seq, a.lastState = 0, ""
	a.hbSeen, a.clockSet, a.rawUp, a.lost, a.downSince = false, false, false, false, now
	a.dropped = 0
	a.restartAt = time.Time{}
	a.haveSeq, a.driving, a.tgtV, a.tgtW = false, false, 0, 0
	a.speed, a.omega, a.vl, a.vr, a.blade, a.bladeRPM = 0, 0, 0, 0, false, 0
	a.long, a.path, a.rec, a.ota = nil, nil, nil, nil
	a.fixLostAt, a.batteryWarned = time.Time{}, false
	a.prevRTK = a.fixLevel() == 4
	a.tele = map[string]time.Time{}
	a.jobDL.cancel()
	a.fwDL.cancel()
	a.mon.endAll()
	a.recv.reset()
	a.bootReason = reason
	a.event("boot", map[string]any{"firmware": a.version, "reason": reason})
}

func (a *autopilot) fixLevel() int { return a.sw.fix }

func (a *autopilot) hasPosition() bool { return a.restartAt.IsZero() && a.fixLevel() >= 1 }

func (a *autopilot) timeOrNil(now time.Time) *float64 {
	if !a.clockSet {
		return nil
	}
	t := tf(now)
	return &t
}

// out sends through the gateway (§14.2); a message the link cannot take is
// dropped and counted.
func (a *autopilot) out(rel string, qos byte, retain bool, payload []byte) {
	if !a.gw.relayUp("autopilot/"+rel, qos, retain, payload) && qos == 1 {
		a.dropped++
	}
}

func (a *autopilot) event(name string, extra map[string]any) {
	m := map[string]any{"time": a.timeOrNil(a.cfg.clock()), "boot": a.st.Boot, "seq": a.seq, "event": name}
	for k, v := range extra {
		m[k] = v
	}
	a.seq++
	payload, _ := json.Marshal(m)
	a.out("event", 1, false, payload)
	slog.Info("autopilot: event", "event", name, "extra", extra)
}

// ---- the board link ---------------------------------------------------------------

// heartbeat is the gateway's heartbeat arriving (§14.4).
func (a *autopilot) heartbeat(now time.Time, mqttUp, serverOnline bool) {
	if !a.restartAt.IsZero() {
		return
	}
	a.hbSeen, a.lastGWHB = true, now
	a.gwMQTT, a.gwServer = mqttUp, serverOnline
	a.clockSet = true
}

func (a *autopilot) boardUp(now time.Time) bool {
	return a.hbSeen && now.Sub(a.lastGWHB) < heartbeatDead
}

// reset is a restart of the autopilot (command restart, update, gateway reset).
func (a *autopilot) reset(now time.Time) { a.beginRestart(now, "reset") }

func (a *autopilot) beginRestart(now time.Time, reason string) {
	a.restartAt = now.Add(a.cfg.apRestart)
	a.bootReason = reason
	slog.Info("autopilot: restarting (simulated)", "reason", reason)
}

// ---- inbound ----------------------------------------------------------------------

func (a *autopilot) inbound(rel string, payload []byte, now time.Time) {
	if !a.restartAt.IsZero() {
		return
	}
	switch rel {
	case "cmd":
		a.onCommand(payload, now)
	case "drive":
		a.onDrive(payload, now)
	case "job/chunk":
		a.jobDL.onChunk(payload, now)
	case "job/res":
		a.jobDL.onRes(payload)
	case "fw/chunk":
		a.fwDL.onChunk(payload, now)
	case "fw/res":
		a.fwDL.onRes(payload)
	}
}

// onDrive applies a setpoint (§9).
func (a *autopilot) onDrive(payload []byte, now time.Time) {
	if a.mode != "manual" && a.mode != "recording" {
		return
	}
	var sp struct {
		Seq  *float64 `json:"seq"`
		Time *float64 `json:"time"`
		V    *float64 `json:"v"`
		W    *float64 `json:"w"`
	}
	if json.Unmarshal(payload, &sp) != nil || sp.Seq == nil || sp.V == nil || sp.W == nil ||
		math.IsNaN(*sp.V) || math.IsNaN(*sp.W) {
		return
	}
	if a.haveSeq && *sp.Seq <= a.lastSeq {
		return
	}
	if a.clockSet && sp.Time != nil && tf(now)-*sp.Time > driveMaxAge.Seconds() {
		return
	}
	a.haveSeq, a.lastSeq = true, *sp.Seq
	a.driving, a.lastDriveAt = true, now
	a.tgtV = math.Max(-maxSpeed, math.Min(maxSpeed, *sp.V))
	a.tgtW = math.Max(-maxTurn, math.Min(maxTurn, *sp.W))
}

// ---- commands ---------------------------------------------------------------------

func (a *autopilot) onCommand(payload []byte, now time.Time) {
	env, ok := a.recv.accept(payload)
	if !ok {
		return
	}
	slog.Info("autopilot <- cmd", "id", env.id, "cmd", env.cmd, "mode", a.mode)
	r := a.recv
	if !slices.Contains(autopilotCmds, env.cmd) {
		r.fail(env, "unknown_cmd", "unknown command "+env.cmd)
		return
	}
	if a.ota != nil && env.cmd != "stop" && env.cmd != "monitor_start" && env.cmd != "monitor_stop" {
		r.fail(env, "busy", "a firmware update is running")
		return
	}
	if modes, restricted := cmdModes[env.cmd]; restricted && !slices.Contains(modes, a.mode) {
		r.fail(env, "wrong_mode", env.cmd+" is not allowed in mode "+a.mode)
		return
	}
	switch env.cmd {
	case "stop":
		a.cmdStop(env, now)
	case "manual_start":
		a.setMode("manual")
		r.done(env, nil)
	case "manual_stop":
		a.setMode("idle")
		r.done(env, nil)
	case "blade":
		on, ok := env.boolean("on")
		if !ok {
			r.fail(env, "bad_request", "blade needs on (true or false)")
			return
		}
		a.blade = on
		r.done(env, nil)
	case "follow":
		a.cmdFollow(env, now)
	case "record_start":
		a.cmdRecordStart(env, now)
	case "record_stop":
		n := a.stopRecording(now, true)
		a.setMode("manual")
		r.done(env, map[string]any{"index": n})
	case "job_start":
		a.cmdJobStart(env, now)
	case "pause":
		if a.paused == nil {
			a.pause("command", now)
		}
		r.done(env, nil)
	case "resume":
		if a.paused != nil {
			if a.fixLevel() < 4 {
				r.fail(env, "no_fix", "No fixed RTK solution")
				return
			}
			a.unpause(now)
		}
		r.done(env, nil)
	case "clear_fault":
		if cause := a.faultCause(); cause != "" {
			r.fail(env, cause, faultMessages[cause])
			return
		}
		a.fault = nil
		a.setMode("idle")
		a.event("fault_cleared", nil)
		r.done(env, nil)
	case "monitor_start":
		if code, msg := a.mon.start(env, now); code != "" {
			r.send(env, "failed", false, a.mon.result(), code, msg)
		} else {
			r.send(env, "done", true, a.mon.result(), "", "")
		}
	case "monitor_stop":
		session, _ := env.str("session")
		a.mon.stop(session)
		r.send(env, "done", true, a.mon.result(), "", "")
	case "ota":
		a.startOTA(env, now)
	case "restart":
		r.done(env, nil)
		a.beginRestart(now, "command")
	}
}

// setMode changes the mode: the blade switches off and live driving starts
// afresh (§7.1, §9).
func (a *autopilot) setMode(mode string) {
	a.mode = mode
	a.blade = false
	a.haveSeq, a.driving, a.tgtV, a.tgtW = false, false, 0, 0
	if mode != "job" {
		a.paused, a.job = nil, nil
	}
	if mode != "recording" {
		a.recording = nil
	}
}

func (a *autopilot) cmdStop(env cmdEnv, now time.Time) {
	switch {
	case a.ota != nil:
		a.fwDL.cancel()
		run := a.ota
		a.ota = nil
		a.recv.fail(run.env, "cancelled", "stopped before the restart")
	case a.path != nil:
		a.endPath("cancelled", "stopped", nil, now)
	}
	if a.rec != nil {
		a.stopRecording(now, true)
	}
	if a.mode != "fault" {
		a.setMode("idle")
	}
	a.blade, a.speed, a.omega = false, 0, 0
	a.recv.done(env, nil)
}

func (a *autopilot) cmdFollow(env cmdEnv, now time.Time) {
	pts, ok := parsePoints(env.raw["points"], 100)
	reverse, _ := env.boolean("reverse")
	blade, _ := env.boolean("blade")
	speed, hasSpeed := env.num("speed")
	switch {
	case !ok:
		a.recv.fail(env, "bad_request", "points must be 1-100 points [lat, lon]")
		return
	case env.has("reverse") && !isBool(env.raw["reverse"]), env.has("blade") && !isBool(env.raw["blade"]),
		env.has("speed") && (!hasSpeed || speed <= 0):
		a.recv.fail(env, "bad_request", "reverse and blade are booleans, speed a number above 0")
		return
	case a.fixLevel() < 4:
		a.recv.fail(env, "no_fix", "No fixed RTK solution")
		return
	}
	a.recv.accepted(env)
	p := &pathRun{kind: "follow", env: env, returnMode: a.mode, reverse: reverse, speed: speed, phase: "drive", reached: -1}
	for _, pt := range pts {
		x, y := a.toLocal(pt[0], pt[1])
		p.pts = append(p.pts, pt2{x, y})
		p.bladeOn = append(p.bladeOn, blade)
		p.segFirst = append(p.segFirst, false)
	}
	a.startPath(p)
}

func isBool(raw json.RawMessage) bool {
	var b bool
	return json.Unmarshal(raw, &b) == nil
}

func (a *autopilot) cmdJobStart(env cmdEnv, now time.Time) {
	job, ok1 := env.str("job")
	size, ok2 := env.num("size")
	sum, ok3 := env.str("sha256")
	from := 0.0
	okFrom := true
	if env.has("from_point") {
		from, okFrom = env.num("from_point")
	}
	if !ok1 || !validID(job) || !ok2 || size < 0 || size != math.Trunc(size) || size > maxJobBytes ||
		!ok3 || !sha256Re.MatchString(sum) || !okFrom || from < 0 || from != math.Trunc(from) {
		a.recv.fail(env, "bad_request", "job_start needs job (an id), size (bytes), sha256 (64 hex characters) and optionally from_point")
		return
	}
	if a.fixLevel() < 4 {
		a.recv.fail(env, "no_fix", "No fixed RTK solution")
		return
	}
	a.recv.accepted(env)
	p := &pathRun{kind: "job", env: env, returnMode: "idle", phase: "download", reached: -1,
		jobID: job, size: int64(size), sha: sum, from: int(from)}
	a.startPath(p)
	a.job = &job
	a.jobDL.start(now, job+".json", nil, func(data []byte, _ [32]byte, err *dlError) { a.onJobFile(p, data, err) })
}

// onJobFile checks and parses the downloaded file (§11, step 3).
func (a *autopilot) onJobFile(p *pathRun, data []byte, err *dlError) {
	if a.path != p {
		return
	}
	now := a.cfg.clock()
	if err != nil {
		code, msg := downloadError(err, "bad_job")
		a.endPath(code, msg, nil, now)
		return
	}
	sum := sha256.Sum256(data)
	if int64(len(data)) != p.size || hex.EncodeToString(sum[:]) != p.sha {
		a.endPath("bad_job", "the file does not match size and sha256 of the command", nil, now)
		return
	}
	if msg := a.loadJob(p, data); msg != "" {
		a.endPath("bad_job", msg, nil, now)
		return
	}
	p.phase = "drive"
}

func (a *autopilot) loadJob(p *pathRun, data []byte) string {
	var f struct {
		Job      string   `json:"job"`
		Speed    *float64 `json:"speed"`
		Segments []struct {
			Blade  bool     `json:"blade"`
			Points []latlon `json:"points"`
		} `json:"segments"`
	}
	if json.Unmarshal(data, &f) != nil {
		return "the file is not a job"
	}
	if f.Job != p.jobID {
		return "the job id in the file differs from the command"
	}
	if len(f.Segments) == 0 {
		return "the job has no segments"
	}
	if f.Speed != nil && *f.Speed > 0 {
		p.speed = *f.Speed
	}
	p.pts, p.bladeOn, p.segFirst = nil, nil, nil
	for _, s := range f.Segments {
		if len(s.Points) == 0 {
			return "a segment has no points"
		}
		for i, pt := range s.Points {
			if !pt.valid() {
				return "a point is not a position"
			}
			x, y := a.toLocal(pt[0], pt[1])
			p.pts = append(p.pts, pt2{x, y})
			p.bladeOn = append(p.bladeOn, s.Blade && i > 0)
			p.segFirst = append(p.segFirst, i == 0)
		}
	}
	if p.from >= len(p.pts) {
		return "from_point is past the last point"
	}
	p.idx = p.from
	return ""
}

// latlon is a point [lat, lon] (§4): exactly two numbers.
type latlon [2]float64

func (p *latlon) UnmarshalJSON(b []byte) error {
	var v []float64
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	if len(v) != 2 {
		return errors.New("a point is [lat, lon]")
	}
	*p = latlon{v[0], v[1]}
	return nil
}

func (p latlon) valid() bool { return p[0] >= -90 && p[0] <= 90 && p[1] >= -180 && p[1] <= 180 }

func parsePoints(raw json.RawMessage, max int) ([]latlon, bool) {
	var pts []latlon
	if raw == nil || json.Unmarshal(raw, &pts) != nil || len(pts) < 1 || len(pts) > max {
		return nil, false
	}
	for _, p := range pts {
		if !p.valid() {
			return nil, false
		}
	}
	return pts, true
}

func (a *autopilot) cmdRecordStart(env cmdEnv, now time.Time) {
	session, ok := env.str("session")
	spacing := 0.1
	okSp := true
	if env.has("spacing") {
		spacing, okSp = env.num("spacing")
	}
	if !ok || !validID(session) || !okSp || spacing < 0.01 || spacing > 100 {
		a.recv.fail(env, "bad_request", "record_start needs session (an id) and optionally spacing (metres, 0.01-100)")
		return
	}
	a.setMode("recording")
	a.recording = &session
	a.rec = &recSession{id: session, spacing: spacing, contig: false}
	a.recv.done(env, nil)
}

func (a *autopilot) startOTA(env cmdEnv, now time.Time) {
	p, code, msg := parseOTA(env, a.version)
	if code != "" {
		a.recv.fail(env, code, msg)
		return
	}
	a.recv.accepted(env)
	run := &otaRun{env: env, p: p}
	a.ota = run
	a.fwDL.start(now, p.file, nil, func(data []byte, _ [32]byte, err *dlError) { a.otaDone(run, data, err) })
}

func (a *autopilot) otaDone(run *otaRun, data []byte, err *dlError) {
	if a.ota != run {
		return
	}
	now := a.cfg.clock()
	fail := func(code, msg string) {
		a.ota = nil
		a.recv.fail(run.env, code, msg)
	}
	if err != nil {
		code, msg := downloadError(err, "bad_image")
		fail(code, msg)
		return
	}
	if code, msg := verifyImage(run.p, data); code != "" {
		fail(code, msg)
		return
	}
	pend := &pendingOTA{ID: run.env.id, Cmd: run.env.cmd, Version: run.p.version, Previous: a.version, Rolled: a.sw.otaRollback}
	if !pend.Rolled {
		prev := a.version
		a.st.Previous, a.st.Firmware, a.st.Partition = &prev, run.p.version, flipPartition(a.st.Partition)
		a.version = run.p.version
	}
	a.st.PendingOTA = pend
	a.sv.save()
	a.confirm = pend
	a.ota = nil
	a.beginRestart(now, "ota")
}

// confirmUpdate sends the final ack of an update once the new image has
// reached the server (§6.5).
func (a *autopilot) confirmUpdate() {
	c := a.confirm
	if c == nil {
		return
	}
	a.confirm, a.st.PendingOTA = nil, nil
	a.sv.save()
	env := cmdEnv{id: c.ID, cmd: c.Cmd}
	if c.Rolled {
		a.recv.fail(env, "rolled_back", "the new image did not confirm; the old one runs again")
	} else {
		a.recv.done(env, map[string]any{"version": a.version, "previous": c.Previous, "partition": a.st.Partition})
	}
}

// ---- paths ------------------------------------------------------------------------

func (a *autopilot) startPath(p *pathRun) {
	a.path = p
	a.long = &longCmd{env: p.env}
	a.setMode("job")
	a.paused, a.job = nil, nil
	a.fixLostAt = time.Time{}
}

// endPath ends the running path: the final ack of its command is done (code
// empty) or the error, and the mode goes back to where it came from.
func (a *autopilot) endPath(code, msg string, result any, now time.Time) {
	p := a.path
	if p == nil {
		return
	}
	a.path, a.long = nil, nil
	a.jobDL.cancel()
	if code == "" {
		a.recv.done(p.env, result)
	} else {
		a.recv.fail(p.env, code, msg)
	}
	back := p.returnMode
	if a.mode == "job" {
		a.setMode(back)
	}
	a.blade, a.speed, a.omega, a.tgtV, a.tgtW = false, 0, 0, 0, 0
}

func (a *autopilot) pause(reason string, now time.Time) {
	r := reason
	a.paused = &r
	a.blade = false
	if reason != "fix" && a.path != nil {
		a.path.suppress = true
	}
	a.updatePauseDL(now)
}

func (a *autopilot) unpause(now time.Time) {
	a.paused = nil
	a.fixLostAt = time.Time{}
	a.updatePauseDL(now)
}

func (a *autopilot) updatePauseDL(now time.Time) {
	if a.path != nil && a.path.phase == "download" {
		a.jobDL.setPaused(a.paused != nil, now)
	}
}

// ---- faults -----------------------------------------------------------------------

func (a *autopilot) faultCause() string {
	if a.sw.fault != "" {
		return a.sw.fault
	}
	if a.battery <= batteryCrit {
		return "battery_low"
	}
	return ""
}

func (a *autopilot) enterFault(code string, now time.Time) {
	if a.rec != nil {
		a.stopRecording(now, true)
	}
	switch {
	case a.path != nil:
		a.endPath(code, faultMessages[code], nil, now)
	case a.ota != nil:
		a.fwDL.cancel()
		run := a.ota
		a.ota = nil
		a.recv.fail(run.env, code, faultMessages[code])
	}
	a.setMode("fault")
	a.fault = &faultInfo{Code: code, Message: faultMessages[code]}
	a.blade, a.speed, a.omega = false, 0, 0
	a.event("fault", map[string]any{"code": code, "message": faultMessages[code]})
}

// ---- state ------------------------------------------------------------------------

func (a *autopilot) publishState(now time.Time) {
	s := apState{Protocol: protocolVersion, Boot: a.st.Boot, Firmware: a.version, Previous: a.st.Previous,
		Partition: a.st.Partition, Mode: a.mode, Paused: a.paused, Job: a.job, Recording: a.recording, Fault: a.fault}
	key, _ := json.Marshal(s)
	if string(key) == a.lastState {
		return
	}
	a.lastState = string(key)
	s.Time = a.timeOrNil(now)
	payload, _ := json.Marshal(s)
	a.out("state", 1, true, payload)
}

func (a *autopilot) publishCatalogue() {
	a.out("metrics/index", 1, true, a.cat.index)
	for _, p := range a.cat.parts {
		a.out("metrics/"+p.name, 1, true, p.payload)
	}
}

func (a *autopilot) monRates(name string) ([]int, bool) {
	d, ok := lookupDef(a.defs, name)
	return d.Rates, ok
}
