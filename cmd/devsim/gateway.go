package main

import (
	"encoding/json"
	"log/slog"
	"math"
	"slices"
	"strings"
	"time"
)

// The simulated gateway (wiki Mower-Protocol §3, §4.2, §6, §12, §15, §16):
// status with last will, state, catalogue, telemetry, commands, monitor, ota,
// data-usage counters, and the relay of the autopilot's topics. Communications
// only: it never reads an autopilot payload, it counts sizes.

const (
	holdMax   = 60 * time.Second // §14.2: reliable messages kept while MQTT is down
	holdBytes = 64 * 1024
)

type heldMsg struct {
	topic   string
	retain  bool
	payload []byte
	at      time.Time
}

type gwState struct {
	Protocol      string   `json:"protocol"`
	Boot          int      `json:"boot"`
	Firmware      string   `json:"firmware"`
	Previous      *string  `json:"previous"`
	Partition     string   `json:"partition"`
	AutopilotLink string   `json:"autopilot_link"`
	NTRIP         string   `json:"ntrip"`
	Operator      *string  `json:"operator"`
	Time          *float64 `json:"time"`
}

type usage struct{ up, down uint64 }

type gateway struct {
	cfg simConfig
	sw  *switches
	st  *boardStore
	sv  *store
	out sink
	ap  *autopilot

	version string
	recv    *receiver
	mon     *monitor
	dl      *downloader
	defs    []metricDef
	cat     catalogue

	mqttUp       bool
	serverOnline bool
	wasReachable bool
	wasLink      bool
	linkDownAt   time.Time
	monEnded     bool
	restartUntil time.Time
	bootAt       time.Time
	lastStep     time.Time
	lastHB       time.Time
	lastAPHB     time.Time
	lastState    string
	lastTele     time.Time

	ntrip struct {
		set                     bool
		host, mount, user, pass string
		port                    int
		state                   string
		since                   time.Time
		upAt                    time.Time
	}
	usage              map[string]*usage
	ntripUp, ntripDown float64
	crc, dropped       uint64
	held               []heldMsg
	heldSize           int
	otaRun             *otaRun
	confirm            *pendingOTA // update to confirm once the server link is up
}

type otaRun struct {
	env cmdEnv
	p   otaParams
}

func newGateway(cfg simConfig, sw *switches, sv *store, out sink) *gateway {
	g := &gateway{cfg: cfg, sw: sw, sv: sv, st: &sv.data.Gateway, out: out}
	g.version = g.st.version(cfg.gwVersion)
	g.defs = gatewayDefs(cfg.gwPeriod.Seconds())
	g.cat = buildCatalogue(g.defs, 1)
	g.recv = newReceiver(cfg.cmdMemory, g.now, func() bool { return true }, &sw.dropAcks)
	g.recv.publish = func(p []byte) { g.emit("gateway/cmd/ack", 1, false, p) }
	g.mon = newMonitor(100, func(p []byte) { g.emit("gateway/monitor", 0, false, p) }, g.monRates, g.value)
	g.dl = newDownloader(func(p []byte) { g.emit("gateway/fw/req", 1, false, p) })
	g.dl.timeout = cfg.dlTimeout
	g.boot(cfg.clock())
	g.confirm = g.st.PendingOTA
	return g
}

func (g *gateway) now() time.Time { return g.cfg.clock() }

// boot resets what a restart resets.
func (g *gateway) boot(now time.Time) {
	g.bootAt, g.lastStep = now, now
	g.usage = map[string]*usage{}
	g.ntripUp, g.ntripDown, g.crc, g.dropped = 0, 0, 0, 0
	g.held, g.heldSize = nil, 0
	g.lastState, g.lastTele = "", time.Time{}
	g.wasReachable, g.wasLink, g.monEnded, g.linkDownAt = false, false, false, time.Time{}
	g.lastHB, g.lastAPHB = time.Time{}, time.Time{}
	g.otaRun = nil
	g.dl.cancel()
	g.mon.endAll()
	g.recv.reset()
	if g.ntrip.set {
		g.ntrip.state, g.ntrip.since = "connecting", now
	} else {
		g.ntrip.state = "off"
	}
}

// reachable: the gateway has MQTT and is not cut off or restarting.
func (g *gateway) reachable() bool {
	return g.mqttUp && !g.sw.muted && g.restartUntil.IsZero()
}

// linkUp is the server link of §4.2: MQTT up and the server online.
func (g *gateway) linkUp() bool { return g.reachable() && g.serverOnline }

func (g *gateway) setMQTT(up bool, now time.Time) {
	g.mqttUp = up
	g.updateReach(now)
}

// updateReach publishes the status: online when the gateway becomes reachable,
// offline (the last will, here played by the gateway) when it is cut off.
func (g *gateway) updateReach(now time.Time) {
	r := g.reachable()
	if r == g.wasReachable {
		return
	}
	g.wasReachable = r
	switch {
	case r:
		g.emit("gateway/status", 1, true, []byte("online"))
		g.flushHeld(now)
	case g.mqttUp:
		g.emit("gateway/status", 1, true, []byte("offline"))
	}
}

// ---- traffic ------------------------------------------------------------------

func (g *gateway) count(name string, size int, up bool) {
	u := g.usage[name]
	if u == nil {
		u = &usage{}
		g.usage[name] = u
	}
	if up {
		u.up += uint64(size)
	} else {
		u.down += uint64(size)
	}
}

func (g *gateway) fullTopic(rel string) string { return g.cfg.prefix + "/" + g.cfg.name + "/" + rel }

// emit publishes one message of the gateway or relayed for the autopilot, and
// counts its bytes. It drops it while the gateway is not reachable.
func (g *gateway) emit(rel string, qos byte, retain bool, payload []byte) {
	if rel != "gateway/status" && !g.reachable() {
		return
	}
	g.count(rel, mqttPacketSize(g.fullTopic(rel), len(payload), qos), true)
	g.out(rel, qos, retain, payload)
}

// relayUp takes a message of the autopilot (§14.2). false: the board link is
// down and the autopilot has dropped it. While MQTT is down, reliable messages
// are held for up to 60 s and 64 KB.
func (g *gateway) relayUp(rel string, qos byte, retain bool, payload []byte) bool {
	if g.sw.boardDown || !g.restartUntil.IsZero() {
		return false
	}
	if g.reachable() {
		g.emit(rel, qos, retain, payload)
		return true
	}
	if qos == 0 {
		return true
	}
	g.held = append(g.held, heldMsg{rel, retain, slices.Clone(payload), g.now()})
	g.heldSize += len(payload)
	for len(g.held) > 0 && (g.heldSize > holdBytes || g.now().Sub(g.held[0].at) > holdMax) {
		g.heldSize -= len(g.held[0].payload)
		g.held = g.held[1:]
		g.dropped++
	}
	return true
}

func (g *gateway) flushHeld(now time.Time) {
	held := g.held
	g.held, g.heldSize = nil, 0
	for _, h := range held {
		if now.Sub(h.at) > holdMax {
			g.dropped++
			continue
		}
		g.emit(h.topic, 1, h.retain, h.payload)
	}
}

// inbound takes a message from the broker.
func (g *gateway) inbound(topic string, payload []byte, now time.Time) {
	if topic == g.cfg.prefix+"/status/server" {
		g.serverOnline = string(payload) == "online"
		if g.reachable() {
			g.count(topic, mqttPacketSize(topic, len(payload), 1), false)
		}
		return
	}
	if !g.reachable() {
		return
	}
	g.count(strings.TrimPrefix(topic, g.cfg.prefix+"/"+g.cfg.name+"/"), mqttPacketSize(topic, len(payload), 1), false)
	rel, ok := strings.CutPrefix(topic, g.cfg.prefix+"/"+g.cfg.name+"/")
	if !ok {
		return
	}
	switch rel {
	case "gateway/cmd":
		g.onCommand(payload, now)
	case "gateway/fw/chunk":
		g.dl.onChunk(payload, now)
	case "gateway/fw/res":
		g.dl.onRes(payload)
	default:
		if sub, ok := strings.CutPrefix(rel, "autopilot/"); ok {
			if g.sw.boardDown || g.apLink(now) != "up" {
				g.dropped++
				return
			}
			g.ap.inbound(sub, payload, now)
		}
	}
}

func (g *gateway) apLink(now time.Time) string {
	if !g.lastAPHB.IsZero() && now.Sub(g.lastAPHB) < 3*time.Second {
		return "up"
	}
	return "down"
}

// apHeartbeat is the autopilot's heartbeat arriving over the board link.
func (g *gateway) apHeartbeat(now time.Time) {
	if g.sw.boardDown || !g.restartUntil.IsZero() {
		return
	}
	g.lastAPHB = now
}

// ---- restart ---------------------------------------------------------------------

func (g *gateway) beginRestart(now time.Time) {
	g.restartUntil = now.Add(g.cfg.gwRestart)
	g.updateReach(now)
	slog.Info("gateway: restarting (simulated)")
}

func (g *gateway) finishRestart(now time.Time) {
	g.restartUntil = time.Time{}
	g.st.Boot++
	if g.confirm != nil && g.confirm.Rolled {
		g.st.Boot++ // the new image did not confirm: a second start, into the old image
	}
	g.sv.save()
	g.boot(now)
	g.updateReach(now)
	slog.Info("gateway: back", "boot", g.st.Boot, "firmware", g.version)
}

// ---- the clock tick ---------------------------------------------------------------

func (g *gateway) step(now time.Time) {
	dt := now.Sub(g.lastStep).Seconds()
	g.lastStep = now
	if !g.restartUntil.IsZero() {
		if now.Before(g.restartUntil) {
			return
		}
		g.finishRestart(now)
	}
	g.updateReach(now)

	// Heartbeat to the autopilot (§14.4), once a second.
	if g.lastHB.IsZero() || now.Sub(g.lastHB) >= time.Second {
		g.lastHB = now
		if !g.sw.boardDown {
			g.ap.heartbeat(now, g.reachable(), g.serverOnline)
		}
	}

	// The server link: publish again when it comes up, end monitor streams when
	// it has been lost for 10 s.
	link := g.linkUp()
	switch {
	case link && !g.wasLink:
		g.lastState = ""
		g.publishCatalogue()
		g.monEnded = false
		g.linkDownAt = time.Time{}
	case !link && g.wasLink:
		g.linkDownAt = now
	}
	g.wasLink = link
	if !link && !g.monEnded && !g.linkDownAt.IsZero() && now.Sub(g.linkDownAt) >= g.cfg.linkLost {
		g.mon.endAll()
		g.monEnded = true
	}

	g.stepNTRIP(now, dt)
	if link {
		g.publishState(now)
		g.confirmUpdate(now)
	}
	g.stepTelemetry(now)
	g.mon.step(now)
	g.dl.tick(now)
}

func (g *gateway) stepNTRIP(now time.Time, dt float64) {
	n := &g.ntrip
	if !n.set {
		n.state = "off"
		return
	}
	switch {
	case g.sw.ntripError:
		n.state = "error"
	case n.state == "error" || n.state == "off":
		n.state, n.since = "connecting", now
	case n.state == "connecting" && now.Sub(n.since) >= 2*time.Second:
		if g.ap.hasPosition() {
			n.state = "streaming"
		} else {
			n.state = "waiting"
		}
	case n.state == "waiting" && g.ap.hasPosition():
		n.state, n.since = "connecting", now
	}
	if n.state == "streaming" && g.apLink(now) == "up" {
		g.ntripDown += 600 * dt // corrections from the caster
		if now.Sub(n.upAt) >= 10*time.Second {
			n.upAt = now
			g.ntripUp += 95 // a GGA sentence
		}
	}
}

func (g *gateway) publishCatalogue() {
	g.emit("gateway/metrics/index", 1, true, g.cat.index)
	for _, p := range g.cat.parts {
		g.emit("gateway/metrics/"+p.name, 1, true, p.payload)
	}
}

func (g *gateway) publishState(now time.Time) {
	op := "24601"
	s := gwState{Protocol: protocolVersion, Boot: g.st.Boot, Firmware: g.version, Previous: g.st.Previous,
		Partition: g.st.Partition, AutopilotLink: g.apLink(now), NTRIP: g.ntrip.state, Operator: &op}
	key, _ := json.Marshal(s)
	if string(key) == g.lastState {
		return
	}
	g.lastState = string(key)
	t := tf(now)
	s.Time = &t
	payload, _ := json.Marshal(s)
	g.emit("gateway/state", 1, true, payload)
}

// confirmUpdate sends the final ack of an update once the new image has
// reached the server (§6.5, step 3 and 4).
func (g *gateway) confirmUpdate(now time.Time) {
	c := g.confirm
	if c == nil {
		return
	}
	g.confirm, g.st.PendingOTA = nil, nil
	g.sv.save()
	env := cmdEnv{id: c.ID, cmd: c.Cmd}
	if c.Rolled {
		g.recv.fail(env, "rolled_back", "the new image did not confirm; the old one runs again")
	} else {
		g.recv.done(env, map[string]any{"version": g.version, "previous": c.Previous, "partition": g.st.Partition})
	}
}

// ---- telemetry --------------------------------------------------------------------

func (g *gateway) stepTelemetry(now time.Time) {
	if !g.lastTele.IsZero() && now.Sub(g.lastTele) < g.cfg.gwPeriod-50*time.Millisecond {
		return
	}
	if !g.reachable() {
		return
	}
	g.lastTele = now
	metrics := map[string]any{}
	for _, d := range g.defs {
		if strings.HasSuffix(d.Name, ".*") {
			continue
		}
		metrics[d.Name] = g.value(d.Name)
	}
	for topic := range g.usage {
		for _, dir := range []string{"up", "down"} {
			name := "usage.mqtt." + dir + "." + topic
			if v := g.value(name); v != nil {
				metrics[name] = v
			}
		}
	}
	payload, _ := json.Marshal(map[string]any{"time": tf(now), "boot": g.st.Boot, "metrics": metrics})
	g.emit("gateway/telemetry", 0, false, payload)
}

func (g *gateway) uptime() float64 { return g.now().Sub(g.bootAt).Seconds() }

func wobble(t, period, amp float64) float64 { return amp * math.Sin(2*math.Pi*t/period) }

// value is a metric's value now; nil when unknown.
func (g *gateway) value(name string) any {
	up := g.uptime()
	var sumUp, sumDown uint64
	for _, u := range g.usage {
		sumUp += u.up
		sumDown += u.down
	}
	switch name {
	case "signal.rssi":
		return int(math.Round(float64(g.sw.signal) + wobble(up, 90, 2)))
	case "link.crc_errors":
		return g.crc
	case "link.dropped":
		return g.dropped
	case "system.cpu":
		return int(math.Round(34 + wobble(up, 47, 8)))
	case "system.core0":
		return int(math.Round(38 + wobble(up, 41, 9)))
	case "system.core1":
		return int(math.Round(30 + wobble(up, 53, 7)))
	case "system.memory.free":
		return int(143000 + wobble(up, 120, 3000))
	case "system.memory.min_free":
		return 121000
	case "system.memory.largest":
		return 90112
	case "system.memory.pct":
		return int(math.Round(56 - wobble(up, 120, 1)))
	case "system.nvs.pct":
		return 34
	case "usage.total.up":
		// What the SIM is charged for: the traffic plus encryption, connection
		// set-up and keep-alive overhead.
		return uint64(float64(sumUp)*1.07+g.ntripUp*1.07) + uint64(up*6) + 2800
	case "usage.total.down":
		return uint64(float64(sumDown)*1.07+g.ntripDown*1.07) + uint64(up*6) + 2400
	case "usage.ntrip.up":
		return uint64(g.ntripUp)
	case "usage.ntrip.down":
		return uint64(g.ntripDown)
	}
	if topic, ok := strings.CutPrefix(name, "usage.mqtt.up."); ok {
		if u := g.usage[topic]; u != nil && u.up > 0 {
			return u.up
		}
	}
	if topic, ok := strings.CutPrefix(name, "usage.mqtt.down."); ok {
		if u := g.usage[topic]; u != nil && u.down > 0 {
			return u.down
		}
	}
	return nil
}

// monRates is the catalogue lookup for monitor_start: a family member exists
// once it has data.
func (g *gateway) monRates(name string) ([]int, bool) {
	d, ok := lookupDef(g.defs, name)
	if !ok || (strings.HasSuffix(d.Name, ".*") && g.value(name) == nil) {
		return nil, false
	}
	return d.Rates, true
}

// ---- commands ---------------------------------------------------------------------

var gatewayCmds = []string{"ping", "restart", "ota", "ntrip_set", "ntrip_clear", "autopilot_reset", "monitor_start", "monitor_stop"}

func (g *gateway) onCommand(payload []byte, now time.Time) {
	env, ok := g.recv.accept(payload)
	if !ok {
		return
	}
	slog.Info("gateway <- cmd", "id", env.id, "cmd", env.cmd)
	r := g.recv
	switch {
	case !slices.Contains(gatewayCmds, env.cmd):
		r.fail(env, "unknown_cmd", "unknown command "+env.cmd)
		return
	case g.otaRun != nil && env.cmd != "monitor_start" && env.cmd != "monitor_stop":
		r.fail(env, "busy", "a firmware update is running")
		return
	}
	switch env.cmd {
	case "ping":
		r.done(env, map[string]any{"pong": g.cfg.name})
	case "restart":
		r.done(env, nil)
		g.beginRestart(now)
	case "autopilot_reset":
		r.done(env, nil)
		g.ap.reset(now)
	case "ntrip_set":
		host, ok1 := env.str("host")
		port, ok2 := env.num("port")
		mount, ok3 := env.str("mountpoint")
		user, ok4 := env.str("user")
		pass, ok5 := env.str("password")
		if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 || host == "" || port < 1 || port > 65535 || port != math.Trunc(port) {
			r.fail(env, "bad_request", "ntrip_set needs host, port (1-65535), mountpoint, user and password")
			return
		}
		g.ntrip.set, g.ntrip.host, g.ntrip.port, g.ntrip.mount, g.ntrip.user, g.ntrip.pass = true, host, int(port), mount, user, pass
		g.ntrip.state, g.ntrip.since = "connecting", now
		r.done(env, nil)
	case "ntrip_clear":
		g.ntrip.set, g.ntrip.state, g.ntrip.pass = false, "off", ""
		r.done(env, nil)
	case "monitor_start":
		if code, msg := g.mon.start(env, now); code != "" {
			r.send(env, "failed", false, g.mon.result(), code, msg)
		} else {
			r.send(env, "done", true, g.mon.result(), "", "")
		}
	case "monitor_stop":
		session, _ := env.str("session")
		g.mon.stop(session)
		r.send(env, "done", true, g.mon.result(), "", "")
	case "ota":
		g.startOTA(env, now)
	}
}

func (g *gateway) startOTA(env cmdEnv, now time.Time) {
	p, code, msg := parseOTA(env, g.version)
	if code == "" && g.sw.signal < -105 {
		code, msg = "low_signal", "the signal is too weak to start an update"
	}
	if code != "" {
		g.recv.fail(env, code, msg)
		return
	}
	g.recv.accepted(env)
	g.otaRun = &otaRun{env: env, p: p}
	g.dl.start(now, p.file, nil, func(data []byte, _ [32]byte, err *dlError) { g.otaDone(data, err, now) })
}

func (g *gateway) otaDone(data []byte, err *dlError, _ time.Time) {
	run := g.otaRun
	if run == nil {
		return
	}
	now := g.now()
	fail := func(code, msg string) {
		g.otaRun = nil
		g.recv.fail(run.env, code, msg)
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
	// Restart into the image; the id of the command survives it.
	pend := &pendingOTA{ID: run.env.id, Cmd: run.env.cmd, Version: run.p.version, Previous: g.version, Rolled: g.sw.otaRollback}
	if !pend.Rolled {
		prev := g.version
		g.st.Previous, g.st.Firmware, g.st.Partition = &prev, run.p.version, flipPartition(g.st.Partition)
		g.version = run.p.version
	}
	g.st.PendingOTA = pend
	g.sv.save()
	g.confirm = pend
	g.otaRun = nil
	g.beginRestart(now)
}
