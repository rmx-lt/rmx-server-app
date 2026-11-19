// Package mqtt is the server's broker client (paho.golang, plain TCP to the
// broker on the internal network), the topic grammar
// <prefix>/<device>/<suffix>, and the routing of a suffix to its handler.
// It is the only package that imports paho.
//
//   - Domains register a handler per suffix (Handle) before Start; the client
//     subscribes to <prefix>/+/<suffix> for each, and answers with Publish on
//     the device's own topics.
//   - HandleTree routes a whole subtree of a device's topics
//     (<prefix>/+/<root>/#) to one handler, which gets messages one at a time,
//     in the order they arrived: state, catalogues and telemetry depend on it.
//     A suffix registered with Handle inside such a subtree (the chunk
//     transfer topics under gateway/ and autopilot/) is served by its own
//     handler instead, concurrently with the subtree's.
//   - It keeps a retained "online" on <prefix>/status/server, replaced by
//     "offline" on clean shutdown or, via the last will, when the connection dies.
//
// The server speaks MQTT 5 (all paho.golang offers); the broker accepts 3.1.1
// and 5 clients side by side, and the topic scheme needs nothing from v5, so
// small device clients can use either.
package mqtt

import (
	"context"
	"log/slog"
	"net"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"

	"github.com/rmx-lt/rmx-server-app/internal/config"
	"github.com/rmx-lt/rmx-server-app/internal/core"
)

const (
	statusOnline  = "online"
	statusOffline = "offline"
	// publishTimeout bounds waiting for the broker to acknowledge a message.
	publishTimeout = 10 * time.Second
)

// Handler handles one message a device published on a registered suffix.
// Each message runs in its own goroutine; ctx ends when the client stops.
type Handler func(ctx context.Context, device core.DeviceID, payload []byte)

// TreeHandler handles one message under a registered root. suffix is the topic
// below <prefix>/<device>/, including the root ("gateway/metrics/battery").
// Messages reach it one at a time, in arrival order.
type TreeHandler func(ctx context.Context, device core.DeviceID, suffix string, payload []byte)

// orderedQueue is how many tree messages may wait for the handler; a message
// that arrives when it is full is dropped (and logged).
const orderedQueue = 4096

// Client is the server's connection to the broker.
type Client struct {
	cfg      config.MQTT
	handlers map[string]Handler
	trees    map[string]TreeHandler
	// ordered carries the messages for tree handlers to their one worker.
	ordered chan func(context.Context)
	cm      *autopaho.ConnectionManager

	connected atomic.Bool

	// workers (the message handlers) stop with stopWorkers.
	workersCtx  context.Context
	stopWorkers context.CancelFunc
	workers     sync.WaitGroup
}

// New returns a client that is not connected yet: register handlers, then Start.
func New(cfg config.MQTT) *Client {
	c := &Client{cfg: cfg, handlers: map[string]Handler{}, trees: map[string]TreeHandler{}, ordered: make(chan func(context.Context), orderedQueue)}
	c.workersCtx, c.stopWorkers = context.WithCancel(context.Background())
	return c
}

// Handle routes messages on <prefix>/<device>/<suffix> to h. Call it before
// Start, once per suffix: two handlers for one suffix panic (two domains
// claiming the same topic).
func (c *Client) Handle(suffix string, h Handler) {
	if c.cm != nil {
		panic("mqtt: Handle after Start")
	}
	if _, dup := c.handlers[suffix]; dup {
		panic("mqtt: a second handler for " + suffix)
	}
	c.handlers[suffix] = h
}

// HandleTree routes every message on <prefix>/<device>/<root>/... to h, in
// arrival order. Call it before Start. root is one topic level ("gateway").
func (c *Client) HandleTree(root string, h TreeHandler) {
	if c.cm != nil {
		panic("mqtt: HandleTree after Start")
	}
	if _, dup := c.trees[root]; dup {
		panic("mqtt: a second handler for " + root + "/#")
	}
	c.trees[root] = h
}

// Routes lists what is registered, sorted: suffixes as they are, trees as
// "<root>/#". The arch test compares it with each domain's contract.
func (c *Client) Routes() []string {
	out := make([]string, 0, len(c.handlers)+len(c.trees))
	for suffix := range c.handlers {
		out = append(out, suffix)
	}
	for root := range c.trees {
		out = append(out, root+"/#")
	}
	slices.Sort(out)
	return out
}

// Start connects in the background. It keeps trying; until it has
// connected, subscribed and announced the server, Connected is false.
func (c *Client) Start() {
	cfg := c.cfg
	if len(c.trees) > 0 {
		c.workers.Add(1)
		go c.runOrdered()
	}
	acfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{{Scheme: "mqtt", Host: net.JoinHostPort(cfg.Host, strconv.Itoa(int(cfg.Port)))}},
		ConnectUsername:               cfg.Username,
		ConnectPassword:               []byte(cfg.Password),
		KeepAlive:                     30,
		CleanStartOnInitialConnection: true,
		SessionExpiryInterval:         0,
		ConnectTimeout:                10 * time.Second,
		// autopaho waits backoff(0) before the first attempt too, so connect at
		// once, then wait so a down broker isn't hammered: 1 s, 2 s, ... up to 30 s.
		ReconnectBackoff: func(attempt int) time.Duration {
			if attempt == 0 {
				return 0
			}
			return min(time.Second<<min(attempt-1, 5), 30*time.Second)
		},
		WillMessage: &paho.WillMessage{
			Topic:   StatusTopic(cfg.TopicPrefix),
			Payload: []byte(statusOffline),
			QoS:     1,
			Retain:  true,
		},
		OnConnectionUp: func(cm *autopaho.ConnectionManager, _ *paho.Connack) {
			slog.Info("mqtt connected")
			// Must not block. Clean session: subscriptions are renewed on every connect.
			go c.ready(cm)
		},
		OnConnectionDown: func() bool {
			c.connected.Store(false)
			slog.Warn("mqtt connection lost")
			return true
		},
		OnConnectError: func(err error) {
			c.connected.Store(false)
			slog.Warn("mqtt connection error", "error", err)
		},
		ClientConfig: paho.ClientConfig{
			ClientID: cfg.ClientID,
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){
				func(pr paho.PublishReceived) (bool, error) {
					c.receive(pr.Packet.Topic, pr.Packet.Payload)
					return true, nil
				},
			},
			OnClientError: func(err error) { slog.Warn("mqtt client error", "error", err) },
			OnServerDisconnect: func(d *paho.Disconnect) {
				slog.Warn("mqtt server disconnected us", "reason", d.ReasonCode)
			},
		},
	}
	cm, err := autopaho.NewConnection(context.Background(), acfg)
	if err != nil {
		// Only a configuration without server URLs fails; ours always has one.
		slog.Error("mqtt setup failed", "error", err)
		return
	}
	c.cm = cm
}

// Connected reports whether the client is connected, subscribed and has
// announced the server.
func (c *Client) Connected() bool { return c != nil && c.connected.Load() }

// ready subscribes to the registered suffixes and announces the server. Only
// then is MQTT reported as up.
func (c *Client) ready(cm *autopaho.ConnectionManager) {
	ctx, cancel := context.WithTimeout(c.workersCtx, publishTimeout)
	defer cancel()
	if len(c.handlers)+len(c.trees) > 0 {
		subs := make([]paho.SubscribeOptions, 0, len(c.handlers)+len(c.trees))
		for suffix := range c.handlers {
			if _, covered := c.trees[firstLevel(suffix)]; covered {
				continue // the tree's subscription delivers it; a second one would deliver it twice
			}
			subs = append(subs, paho.SubscribeOptions{Topic: DeviceFilter(c.cfg.TopicPrefix, suffix), QoS: 1})
		}
		for root := range c.trees {
			subs = append(subs, paho.SubscribeOptions{Topic: TreeFilter(c.cfg.TopicPrefix, root), QoS: 1})
		}
		if _, err := cm.Subscribe(ctx, &paho.Subscribe{Subscriptions: subs}); err != nil {
			slog.Error("mqtt subscribe failed", "error", err)
			return
		}
	}
	_, err := cm.Publish(ctx, &paho.Publish{
		Topic:   StatusTopic(c.cfg.TopicPrefix),
		QoS:     1,
		Retain:  true,
		Payload: []byte(statusOnline),
	})
	if err != nil {
		slog.Error("mqtt status publish failed", "error", err)
		return
	}
	c.connected.Store(true)
}

// receive routes one incoming message. A suffix with its own handler runs in
// its own goroutine; any other message under a tree root is queued for the
// ordered worker.
func (c *Client) receive(topic string, payload []byte) {
	device, suffix, ok := ParseDeviceTopic(c.cfg.TopicPrefix, topic)
	if !ok {
		slog.Debug("ignoring message on unexpected topic", "topic", topic)
		return
	}
	if h, ok := c.handlers[suffix]; ok {
		c.workers.Add(1)
		go func() {
			defer c.workers.Done()
			h(c.workersCtx, device, payload)
		}()
		return
	}
	if th, ok := c.trees[firstLevel(suffix)]; ok {
		payload = slices.Clone(payload)
		select {
		case c.ordered <- func(ctx context.Context) { th(ctx, device, suffix, payload) }:
		default:
			slog.Warn("mqtt queue is full; dropping a message", "topic", topic)
		}
		return
	}
	slog.Debug("ignoring message on unexpected topic", "topic", topic)
}

// runOrdered runs the tree messages one after another until the client stops.
func (c *Client) runOrdered() {
	defer c.workers.Done()
	for {
		select {
		case fn := <-c.ordered:
			fn(c.workersCtx)
		case <-c.workersCtx.Done():
			return
		}
	}
}

func firstLevel(suffix string) string {
	first, _, _ := strings.Cut(suffix, "/")
	return first
}

// Publish sends payload (QoS 1, not retained) on <prefix>/<device>/<suffix>.
func (c *Client) Publish(ctx context.Context, device core.DeviceID, suffix string, payload []byte) error {
	ctx, cancel := context.WithTimeout(ctx, publishTimeout)
	defer cancel()
	_, err := c.cm.Publish(ctx, &paho.Publish{Topic: DeviceTopic(c.cfg.TopicPrefix, device, suffix), QoS: 1, Payload: payload})
	return err
}

// PublishFast sends payload with QoS 0 (no acknowledgement, not retained): for
// messages that are worthless when late, like live-driving setpoints.
func (c *Client) PublishFast(ctx context.Context, device core.DeviceID, suffix string, payload []byte) error {
	ctx, cancel := context.WithTimeout(ctx, publishTimeout)
	defer cancel()
	_, err := c.cm.Publish(ctx, &paho.Publish{Topic: DeviceTopic(c.cfg.TopicPrefix, device, suffix), QoS: 0, Payload: payload})
	return err
}

// Stop marks the server offline and disconnects cleanly. Call it after HTTP is drained.
func (c *Client) Stop() {
	c.stopWorkers()
	c.workers.Wait()
	if c.cm == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if c.connected.Swap(false) {
		// A clean disconnect discards the last will, so say it ourselves.
		_, err := c.cm.Publish(ctx, &paho.Publish{
			Topic:   StatusTopic(c.cfg.TopicPrefix),
			QoS:     1,
			Retain:  true,
			Payload: []byte(statusOffline),
		})
		if err != nil {
			slog.Warn("mqtt offline status failed", "error", err)
		}
	}
	if err := c.cm.Disconnect(ctx); err != nil {
		slog.Warn("mqtt disconnect timed out")
	}
	slog.Info("mqtt stopped")
}
