// devsim: a simulated mower gateway for local development. It connects to the
// local broker (compose.dev.yaml) as a device and behaves like
// rmx-mower-gateway: presence on mower/<name>/status, remote commands on
// mower/<name>/cmd (ping, status, gps, ota, restart), and firmware downloads
// over MQTT from the local rmx-server.
//
//	go run ./cmd/devsim                      # device "mower-sim"
//	go run ./cmd/devsim -name mower-02       # another one
//	go run ./cmd/devsim send status          # send a command as the app, print the ack
//	go run ./cmd/devsim send ota version=0.4.0 size=12345
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

func run(args []string) int {
	b := loadBroker()
	if len(args) > 0 && args[0] == "send" {
		return send(b, args[1:])
	}
	fs := flag.NewFlagSet("devsim", flag.ContinueOnError)
	name := fs.String("name", env("DEVSIM_NAME", "mower-sim"), "device name (MQTT client id and <name> in mower/<name>/...)")
	version := fs.String("version", "0.0.0-sim", "firmware version the device reports")
	if fs.Parse(args) != nil {
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := simulate(ctx, b, *name, *version); err != nil {
		slog.Error("devsim", "error", err)
		return 1
	}
	return 0
}

// simulate runs one device until ctx ends.
func simulate(ctx context.Context, b broker, name, version string) error {
	d := newDevice(name, version, time.Now)
	topic := func(suffix string) string { return b.prefix + "/" + name + "/" + suffix }
	var cm *autopaho.ConnectionManager
	publish := func(t string, payload []byte, retain bool) error {
		pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		_, err := cm.Publish(pctx, &paho.Publish{Topic: t, QoS: 1, Retain: retain, Payload: payload})
		return err
	}
	ack := func(r *reply) {
		data, _ := json.Marshal(r)
		slog.Info("-> cmd/ack", "reply", string(data))
		if err := publish(topic("cmd/ack"), data, false); err != nil {
			slog.Warn("ack publish failed", "error", err)
		}
	}
	fw := &fwClient{publish: func(p []byte) error { return publish(topic("fw/req"), p, false) }, timeout: 10 * time.Second}

	// reboot: offline, a pause, online again with a fresh uptime.
	reboot := func(previous string) {
		_ = publish(topic("status"), []byte("offline"), true)
		slog.Info("restarting (simulated)")
		time.Sleep(3 * time.Second)
		d.boot()
		_ = publish(topic("status"), []byte("online"), true)
		if previous != "" {
			report, _ := json.Marshal(d.firmwareReport(previous))
			_ = publish(topic("firmware"), report, true)
		}
		slog.Info("back online", "version", d.status().Version)
	}
	runOTA := func(job *otaJob) {
		t0 := time.Now()
		slog.Info("ota: downloading", "file", job.file, "version", job.version)
		_, err := fw.download(ctx, job.file, job.size, job.version, d.progress)
		if err != nil {
			fe, _ := err.(*fwError)
			if fe == nil {
				fe = &fwError{"failed", err.Error()}
			}
			d.finishOTA(job, fe.code)
			ack(d.otaAck(job, t0, fe.code, fe.message))
			return
		}
		ack(d.otaAck(job, t0, "", ""))
		d.finishOTA(job, "")
		reboot(job.from)
	}
	onCommand := func(payload []byte) {
		slog.Info("<- cmd", "command", string(payload))
		r, job, restart := d.handle(payload)
		if r == nil {
			slog.Warn("duplicate command id ignored")
			return
		}
		ack(r)
		if job != nil {
			go runOTA(job)
		}
		if restart {
			go reboot("")
		}
	}

	cfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{{Scheme: "mqtt", Host: net.JoinHostPort(b.host, b.port)}},
		ConnectUsername:               "test-device",
		ConnectPassword:               []byte(env("TEST_DEVICE_PASSWORD", "test-device-dev")),
		KeepAlive:                     60,
		CleanStartOnInitialConnection: true,
		ConnectTimeout:                10 * time.Second,
		ReconnectBackoff:              func(attempt int) time.Duration { return min(time.Second<<min(attempt, 4), 15*time.Second) },
		WillMessage:                   &paho.WillMessage{Topic: topic("status"), Payload: []byte("offline"), QoS: 1, Retain: true},
		OnConnectionUp: func(cm *autopaho.ConnectionManager, _ *paho.Connack) {
			go func() {
				sctx, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()
				_, err := cm.Subscribe(sctx, &paho.Subscribe{Subscriptions: []paho.SubscribeOptions{
					{Topic: topic("cmd"), QoS: 1}, {Topic: topic("fw/chunk"), QoS: 1},
					{Topic: topic("fw/res"), QoS: 1}, {Topic: b.prefix + "/status/server", QoS: 1},
				}})
				if err != nil {
					slog.Error("subscribe failed", "error", err)
					return
				}
				_ = publish(topic("status"), []byte("online"), true)
				slog.Info("online", "device", name, "broker", net.JoinHostPort(b.host, b.port), "version", d.status().Version)
			}()
		},
		OnConnectError: func(err error) { slog.Warn("cannot connect (is compose.dev.yaml up?)", "error", err) },
		ClientConfig: paho.ClientConfig{
			ClientID: name,
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){func(pr paho.PublishReceived) (bool, error) {
				t, p := pr.Packet.Topic, pr.Packet.Payload
				switch t {
				case topic("cmd"):
					go onCommand(p)
				case topic("fw/chunk"):
					fw.deliver(p, true)
				case topic("fw/res"):
					fw.deliver(p, false)
				case b.prefix + "/status/server":
					slog.Info("server is " + string(p))
				}
				return true, nil
			}},
		},
	}
	var err error
	cm, err = autopaho.NewConnection(ctx, cfg)
	if err != nil {
		return err
	}
	<-ctx.Done()
	// A clean disconnect doesn't send the will: say offline first.
	octx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = cm.Publish(octx, &paho.Publish{Topic: topic("status"), QoS: 1, Retain: true, Payload: []byte("offline")})
	_ = cm.Disconnect(octx)
	return nil
}

// status is a snapshot for logging.
func (d *device) status() statusResult {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.statusLocked()
}

// send publishes one command as the app login and prints the ack.
func send(b broker, args []string) int {
	fs := flag.NewFlagSet("devsim send", flag.ContinueOnError)
	name := fs.String("name", env("DEVSIM_NAME", "mower-sim"), "device to send to")
	timeout := fs.Duration("timeout", 30*time.Second, "how long to wait for the ack (ota: the first ack)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: devsim send [-name mower-sim] [-timeout 30s] <cmd> [key=value ...]")
		fs.PrintDefaults()
	}
	if fs.Parse(args) != nil || fs.NArg() < 1 {
		fs.Usage()
		return 2
	}
	cmd := map[string]any{"id": "dev-" + newRequestID()[4:], "cmd": fs.Arg(0), "expires_at": time.Now().Add(time.Minute).Unix()}
	for _, kv := range fs.Args()[1:] {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			fmt.Fprintf(os.Stderr, "not key=value: %s\n", kv)
			return 2
		}
		var n json.Number
		if json.Unmarshal([]byte(v), &n) == nil {
			cmd[k] = n
		} else {
			cmd[k] = v
		}
	}
	payload, _ := json.Marshal(cmd)
	topic := func(suffix string) string { return b.prefix + "/" + *name + "/" + suffix }

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	acks := make(chan []byte, 4)
	cfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{{Scheme: "mqtt", Host: net.JoinHostPort(b.host, b.port)}},
		ConnectUsername:               env("MQTT_USERNAME", "app"),
		ConnectPassword:               []byte(env("MQTT_PASSWORD", "app-dev")),
		KeepAlive:                     30,
		CleanStartOnInitialConnection: true,
		ConnectTimeout:                10 * time.Second,
		OnConnectError:                func(err error) { slog.Warn("cannot connect", "error", err) },
		ClientConfig: paho.ClientConfig{
			ClientID: "devsim-send-" + newRequestID()[4:],
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
	// ota answers twice: "started", then "done" or an error (a download takes a while).
	timer := time.NewTimer(*timeout)
	defer timer.Stop()
	for want := 1; want > 0; want-- {
		select {
		case a := <-acks:
			fmt.Printf("<- %s\n", a)
			var r struct {
				OK     bool
				Result struct{ State string }
			}
			_ = json.Unmarshal(a, &r)
			if cmd["cmd"] == "ota" && r.OK && r.Result.State == "started" {
				want++
				timer.Reset(10 * time.Minute)
			}
		case <-timer.C:
			fmt.Fprintln(os.Stderr, "no ack (is the device running? go run ./cmd/devsim)")
			return 1
		}
	}
	return 0
}
