package main

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// config holds everything the simulated mower needs; the zero values of the
// durations are replaced by the contract's numbers in newMower.
type simConfig struct {
	prefix, name         string
	gwVersion, apVersion string
	statePath            string
	clock                func() time.Time

	gwPeriod  time.Duration // gateway telemetry period (60 s in the contract)
	gwRestart time.Duration // how long the gateway is away on restart
	apRestart time.Duration
	linkLost  time.Duration // §4.2: down this long is "lost" (10 s)
	fixGrace  time.Duration // §7.1: how long a path goes on without a fixed solution
	cmdMemory time.Duration // §5: how long a command id is remembered (2 min)
	dlTimeout time.Duration // §12.4 (10 s)

	originLat, originLon float64
}

func (c *simConfig) defaults() {
	if c.clock == nil {
		c.clock = time.Now
	}
	set := func(d *time.Duration, v time.Duration) {
		if *d == 0 {
			*d = v
		}
	}
	set(&c.gwPeriod, 60*time.Second)
	set(&c.gwRestart, 5*time.Second)
	set(&c.apRestart, 2*time.Second)
	set(&c.linkLost, 10*time.Second)
	set(&c.fixGrace, 3*time.Second)
	set(&c.cmdMemory, 2*time.Minute)
	set(&c.dlTimeout, defaultTmout)
	if c.originLat == 0 && c.originLon == 0 {
		c.originLat, c.originLon = 54.687157, 25.279652
	}
	if c.gwVersion == "" {
		c.gwVersion = "0.0.0-sim"
	}
	if c.apVersion == "" {
		c.apVersion = "0.0.0-sim"
	}
}

// switches provoke the edge cases (see applySwitch for the names).
type switches struct {
	dropAcks    atomic.Int64
	muted       bool   // link=down: the gateway is away from the server
	boardDown   bool   // board-link=down: the UART between the boards is cut
	fix         int    // index into fixNames
	fault       string // a fault cause the autopilot detects until it is cleared
	signal      int    // dBm
	otaRollback bool
	ntripError  bool
}

// mower is both boards. Every entry point takes the lock; the boards call each
// other directly and never block.
type mower struct {
	mu  sync.Mutex
	cfg simConfig
	sw  *switches
	st  *store
	gw  *gateway
	ap  *autopilot
}

func newMower(cfg simConfig, out sink) *mower {
	cfg.defaults()
	m := &mower{cfg: cfg, sw: &switches{fix: 4, signal: -71}, st: loadStore(cfg.statePath)}
	m.st.data.Gateway.start()
	m.st.data.Autopilot.start()
	m.st.save()
	m.gw = newGateway(cfg, m.sw, m.st, out)
	m.ap = newAutopilot(cfg, m.sw, m.st, m.gw)
	m.gw.ap = m.ap
	return m
}

// subscriptions are the topics the gateway needs from the broker: its own, the
// autopilot's six (§14.2) and the server's status.
func (m *mower) subscriptions() []string {
	base := m.cfg.prefix + "/" + m.cfg.name + "/"
	subs := []string{m.cfg.prefix + "/status/server"}
	for _, t := range []string{"gateway/cmd", "gateway/fw/chunk", "gateway/fw/res",
		"autopilot/cmd", "autopilot/drive", "autopilot/job/chunk", "autopilot/job/res",
		"autopilot/fw/chunk", "autopilot/fw/res"} {
		subs = append(subs, base+t)
	}
	return subs
}

// inbound handles a message from the broker; topic is the full topic.
func (m *mower) inbound(topic string, payload []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gw.inbound(topic, payload, m.cfg.clock())
}

// step advances both boards to the clock's now.
func (m *mower) step() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.cfg.clock()
	m.gw.step(now)
	m.ap.step(now)
}

// setMQTT tells the gateway whether its MQTT connection is up.
func (m *mower) setMQTT(up bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gw.setMQTT(up, m.cfg.clock())
}

// set flips a switch: name and value as in `devsim ctl`.
//
//	drop-acks N         the next N acks (of both boards) are not sent
//	link up|down        down: the gateway is away from the server (offline, nothing sent or received)
//	board-link up|down  down: the UART between the boards is cut
//	fix <name>          none, single, dgps, rtk_float or rtk_fixed
//	fault <code>|none   a cause the autopilot detects: motor_stall, blade_stall, battery_low, internal
//	battery <pct>       set the battery level
//	signal <dBm>        the modem's signal; below -105 an ota is refused with low_signal
//	ota-rollback on|off the next update does not confirm and is rolled back
//	ntrip ok|error      the NTRIP client's state
func (m *mower) set(name, value string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.cfg.clock()
	onOff := func() (bool, error) {
		switch strings.ToLower(value) {
		case "on", "true", "1", "down", "yes":
			return true, nil
		case "off", "false", "0", "up", "no":
			return false, nil
		}
		return false, fmt.Errorf("%s: want on/off, got %q", name, value)
	}
	switch name {
	case "drop-acks":
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 {
			return fmt.Errorf("drop-acks: want a number, got %q", value)
		}
		m.sw.dropAcks.Store(int64(n))
	case "link":
		down, err := onOff()
		if err != nil {
			return err
		}
		m.sw.muted = down
		m.gw.updateReach(now)
	case "board-link":
		down, err := onOff()
		if err != nil {
			return err
		}
		m.sw.boardDown = down
	case "fix":
		for i, f := range fixNames {
			if f == value {
				m.sw.fix = i
				return nil
			}
		}
		return fmt.Errorf("fix: want one of %s, got %q", strings.Join(fixNames, ", "), value)
	case "fault":
		if value == "none" || value == "" {
			m.sw.fault = ""
			return nil
		}
		if _, ok := faultMessages[value]; !ok {
			return fmt.Errorf("fault: want none or one of %s, got %q", strings.Join(faultCodes, ", "), value)
		}
		m.sw.fault = value
	case "battery":
		p, err := strconv.ParseFloat(value, 64)
		if err != nil || p < 0 || p > 100 {
			return fmt.Errorf("battery: want 0-100, got %q", value)
		}
		m.ap.battery = p
	case "signal":
		n, err := strconv.Atoi(value)
		if err != nil || n > 0 || n < -140 {
			return fmt.Errorf("signal: want dBm (negative), got %q", value)
		}
		m.sw.signal = n
	case "ota-rollback":
		on, err := onOff()
		if err != nil {
			return err
		}
		m.sw.otaRollback = on
	case "ntrip":
		switch value {
		case "ok":
			m.sw.ntripError = false
		case "error":
			m.sw.ntripError = true
		default:
			return fmt.Errorf("ntrip: want ok or error, got %q", value)
		}
	default:
		return fmt.Errorf("unknown switch %q", name)
	}
	return nil
}

// switchNames lists them for the help text.
const switchNames = "drop-acks link board-link fix fault battery signal ota-rollback ntrip"
