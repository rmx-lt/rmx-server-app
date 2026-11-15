// devsim: a simulated mower for local development, both boards of wiki
// Mower-Protocol: the gateway (status, state, catalogue, telemetry, commands,
// monitor, ota) and the autopilot (state machine, telemetry, events, live
// driving, recording, follow, jobs). It connects to the local broker
// (compose.dev.yaml) as a device and talks to the local rmx-server.
//
//	go run ./cmd/devsim                        # device "mower-sim"
//	go run ./cmd/devsim -name mower-02         # another one
//	go run ./cmd/devsim -set fix=rtk_float     # start with a switch set
//	go run ./cmd/devsim ctl fix none           # flip a switch of the running one
//	go run ./cmd/devsim send -board autopilot manual_start
//	go run ./cmd/devsim send -board autopilot follow 'points=[[54.687157,25.279652]]'
//
// Settings come from .env like the server's: MQTT_HOST, MQTT_PORT,
// MQTT_TOPIC_PREFIX, TEST_DEVICE_PASSWORD (device login test-device) and
// MQTT_USERNAME / MQTT_PASSWORD (the app login, for send).
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"

	"github.com/rmx-lt/rmx-server-app/internal/config"
)

func main() { os.Exit(run(os.Args[1:])) }

type broker struct {
	host, port, prefix string
}

func loadBroker() broker {
	config.LoadDotenv(".env")
	return broker{
		host:   env("MQTT_HOST", "127.0.0.1"),
		port:   env("MQTT_PORT", "11883"),
		prefix: env("MQTT_TOPIC_PREFIX", "mower"),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

const defaultControl = "127.0.0.1:18090"

type setFlags []string

func (s *setFlags) String() string     { return strings.Join(*s, ",") }
func (s *setFlags) Set(v string) error { *s = append(*s, v); return nil }

func run(args []string) int {
	b := loadBroker()
	if len(args) > 0 {
		switch args[0] {
		case "send":
			return send(b, args[1:])
		case "ctl":
			return ctl(args[1:])
		}
	}
	fs := flag.NewFlagSet("devsim", flag.ContinueOnError)
	name := fs.String("name", env("DEVSIM_NAME", "mower-sim"), "device name (MQTT client id and <name> in mower/<name>/...)")
	gwVersion := fs.String("version", "0.0.0-sim", "firmware version the gateway reports")
	apVersion := fs.String("autopilot-version", "0.0.0-sim", "firmware version the autopilot reports")
	statePath := fs.String("state", "", "file for the boot counters and firmware (default .dev/devsim-<name>.json; \"-\" keeps them in memory)")
	control := fs.String("control", defaultControl, "address of the control endpoint for `devsim ctl` (empty: none)")
	period := fs.Duration("gateway-period", 60*time.Second, "gateway telemetry period (the catalogue reports it)")
	var sets setFlags
	fs.Var(&sets, "set", "start with a switch set, name=value (repeatable); switches: "+switchNames)
	if fs.Parse(args) != nil {
		return 2
	}
	path := *statePath
	switch path {
	case "":
		path = ".dev/devsim-" + *name + ".json"
	case "-":
		path = ""
	}
	cfg := config2(b, *name, *gwVersion, *apVersion, path, *period)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := simulate(ctx, b, cfg, *control, sets); err != nil {
		slog.Error("devsim", "error", err)
		return 1
	}
	return 0
}

func config2(b broker, name, gw, ap, statePath string, period time.Duration) simConfig {
	return simConfig{prefix: b.prefix, name: name, gwVersion: gw, apVersion: ap, statePath: statePath, gwPeriod: period}
}

type outMsg struct {
	topic   string
	qos     byte
	retain  bool
	payload []byte
}

// simulate runs one mower until ctx ends.
func simulate(ctx context.Context, b broker, cfg simConfig, controlAddr string, sets []string) error {
	queue := make(chan outMsg, 4096)
	m := newMower(cfg, func(topic string, qos byte, retain bool, payload []byte) {
		select {
		case queue <- outMsg{topic, qos, retain, payload}:
		default:
			slog.Warn("publish queue full, message dropped", "topic", topic)
		}
	})
	for _, kv := range sets {
		k, v, _ := strings.Cut(kv, "=")
		if err := m.set(k, v); err != nil {
			return err
		}
	}
	base := b.prefix + "/" + cfg.name + "/"
	var cm *autopaho.ConnectionManager

	acfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{{Scheme: "mqtt", Host: net.JoinHostPort(b.host, b.port)}},
		ConnectUsername:               "test-device",
		ConnectPassword:               []byte(env("TEST_DEVICE_PASSWORD", "test-device-dev")),
		KeepAlive:                     15,
		CleanStartOnInitialConnection: true,
		ConnectTimeout:                10 * time.Second,
		ReconnectBackoff:              func(attempt int) time.Duration { return min(time.Second<<min(attempt, 4), 15*time.Second) },
		WillMessage:                   &paho.WillMessage{Topic: base + "gateway/status", Payload: []byte("offline"), QoS: 1, Retain: true},
		OnConnectionUp: func(cm *autopaho.ConnectionManager, _ *paho.Connack) {
			go func() {
				sctx, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()
				var subs []paho.SubscribeOptions
				for _, t := range m.subscriptions() {
					subs = append(subs, paho.SubscribeOptions{Topic: t, QoS: 1})
				}
				if _, err := cm.Subscribe(sctx, &paho.Subscribe{Subscriptions: subs}); err != nil {
					slog.Error("subscribe failed", "error", err)
					return
				}
				m.setMQTT(true)
				slog.Info("online", "device", cfg.name, "broker", net.JoinHostPort(b.host, b.port),
					"note", "state and catalogues follow once mower/status/server says online")
			}()
		},
		OnConnectError: func(err error) { slog.Warn("cannot connect (is compose.dev.yaml up?)", "error", err) },
		ClientConfig: paho.ClientConfig{
			ClientID:      cfg.name,
			OnClientError: func(err error) { m.setMQTT(false); slog.Warn("mqtt", "error", err) },
			OnServerDisconnect: func(d *paho.Disconnect) {
				m.setMQTT(false)
				slog.Warn("broker disconnected", "reason", d.ReasonCode)
			},
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){func(pr paho.PublishReceived) (bool, error) {
				m.inbound(pr.Packet.Topic, pr.Packet.Payload)
				return true, nil
			}},
		},
	}
	var err error
	cm, err = autopaho.NewConnection(ctx, acfg)
	if err != nil {
		return err
	}

	go func() {
		for msg := range queue {
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			if _, err := cm.Publish(pctx, &paho.Publish{Topic: base + msg.topic, QoS: msg.qos, Retain: msg.retain, Payload: msg.payload}); err != nil && ctx.Err() == nil {
				slog.Warn("publish failed", "topic", msg.topic, "error", err)
			}
			cancel()
		}
	}()
	if controlAddr != "" {
		go serveControl(ctx, controlAddr, m)
	}
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
loop:
	for {
		select {
		case <-ctx.Done():
			break loop
		case <-tick.C:
			m.step()
		}
	}
	// A clean disconnect doesn't send the will: say offline first.
	octx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = cm.Publish(octx, &paho.Publish{Topic: base + "gateway/status", QoS: 1, Retain: true, Payload: []byte("offline")})
	_ = cm.Disconnect(octx)
	return nil
}

// ---- the control endpoint -----------------------------------------------------------

func serveControl(ctx context.Context, addr string, m *mower) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /switch", func(w http.ResponseWriter, r *http.Request) {
		if err := m.set(r.FormValue("name"), r.FormValue("value")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		slog.Info("switch", "name", r.FormValue("name"), "value", r.FormValue("value"))
		fmt.Fprintln(w, "ok")
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "switches: "+switchNames)
	})
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { <-ctx.Done(); _ = srv.Close() }()
	if err := srv.ListenAndServe(); err != nil && ctx.Err() == nil {
		slog.Warn("control endpoint not available (devsim ctl will not work)", "addr", addr, "error", err)
	}
}

// ctl flips a switch of a running devsim.
func ctl(args []string) int {
	fs := flag.NewFlagSet("devsim ctl", flag.ContinueOnError)
	addr := fs.String("addr", defaultControl, "control endpoint of the running devsim")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: devsim ctl [-addr "+defaultControl+"] <switch> <value>\nswitches: "+switchNames)
		fs.PrintDefaults()
	}
	if fs.Parse(args) != nil || fs.NArg() != 2 {
		fs.Usage()
		return 2
	}
	resp, err := http.PostForm("http://"+*addr+"/switch", url.Values{"name": {fs.Arg(0)}, "value": {fs.Arg(1)}})
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot reach devsim:", err)
		return 1
	}
	defer resp.Body.Close()
	var buf [512]byte
	n, _ := resp.Body.Read(buf[:])
	fmt.Print(string(buf[:n]))
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

// ---- send ---------------------------------------------------------------------------

func newRequestID() string { return fmt.Sprintf("dev-%d", time.Now().UnixNano()%1_000_000_000_000) }

// send publishes one command as the app login (standing in for the server) and
// prints the acks: the accepted one and the final one.
func send(b broker, args []string) int {
	fs := flag.NewFlagSet("devsim send", flag.ContinueOnError)
	name := fs.String("name", env("DEVSIM_NAME", "mower-sim"), "device to send to")
	board := fs.String("board", "gateway", "gateway or autopilot")
	timeout := fs.Duration("timeout", 30*time.Second, "how long to wait for an ack")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: devsim send [-name mower-sim] [-board gateway|autopilot] [-timeout 30s] <cmd> [key=value ...]")
		fmt.Fprintln(fs.Output(), "values are JSON when they parse as JSON (numbers, true, [[1,2]]), else text")
		fs.PrintDefaults()
	}
	if fs.Parse(args) != nil || fs.NArg() < 1 || (*board != "gateway" && *board != "autopilot") {
		fs.Usage()
		return 2
	}
	cmd := map[string]any{"id": newRequestID(), "cmd": fs.Arg(0), "expires_at": time.Now().Add(time.Minute).Unix()}
	for _, kv := range fs.Args()[1:] {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			fmt.Fprintf(os.Stderr, "not key=value: %s\n", kv)
			return 2
		}
		var j any
		if json.Unmarshal([]byte(v), &j) == nil {
			cmd[k] = j
		} else {
			cmd[k] = v
		}
	}
	payload, _ := json.Marshal(cmd)
	topic := func(suffix string) string { return b.prefix + "/" + *name + "/" + *board + "/" + suffix }

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	acks := make(chan []byte, 8)
	cfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{{Scheme: "mqtt", Host: net.JoinHostPort(b.host, b.port)}},
		ConnectUsername:               env("MQTT_USERNAME", "app"),
		ConnectPassword:               []byte(env("MQTT_PASSWORD", "app-dev")),
		KeepAlive:                     30,
		CleanStartOnInitialConnection: true,
		ConnectTimeout:                10 * time.Second,
		OnConnectError:                func(err error) { slog.Warn("cannot connect", "error", err) },
		ClientConfig: paho.ClientConfig{
			ClientID: "devsim-send-" + newRequestID(),
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){func(pr paho.PublishReceived) (bool, error) {
				var r struct{ ID string }
				if json.Unmarshal(pr.Packet.Payload, &r) == nil && r.ID == cmd["id"] {
					acks <- pr.Packet.Payload
				}
				return true, nil
			}},
		},
	}
	cm, err := autopaho.NewConnection(ctx, cfg)
	wctx, wcancel := context.WithTimeout(ctx, 15*time.Second)
	defer wcancel()
	if err != nil || cm.AwaitConnection(wctx) != nil {
		fmt.Fprintln(os.Stderr, "cannot reach the broker (is compose.dev.yaml up?)")
		return 1
	}
	defer cm.Disconnect(context.Background())
	if _, err := cm.Subscribe(wctx, &paho.Subscribe{Subscriptions: []paho.SubscribeOptions{{Topic: topic("cmd/ack"), QoS: 1}}}); err != nil {
		fmt.Fprintln(os.Stderr, "subscribe:", err)
		return 1
	}
	fmt.Printf("-> %s %s\n", topic("cmd"), payload)
	if _, err := cm.Publish(wctx, &paho.Publish{Topic: topic("cmd"), QoS: 1, Payload: payload}); err != nil {
		fmt.Fprintln(os.Stderr, "publish:", err)
		return 1
	}
	timer := time.NewTimer(*timeout)
	defer timer.Stop()
	for {
		select {
		case a := <-acks:
			fmt.Printf("<- %s\n", a)
			var r struct {
				OK    bool
				State string
			}
			_ = json.Unmarshal(a, &r)
			switch r.State {
			case "accepted":
				timer.Reset(10 * time.Minute) // a long-running command: wait for the final ack
			case "done":
				return 0
			default:
				return 1
			}
		case <-timer.C:
			fmt.Fprintln(os.Stderr, "no ack (is the device running? go run ./cmd/devsim; is the server online?)")
			return 1
		}
	}
}
