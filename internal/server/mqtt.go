package server

import (
	"context"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"

	"github.com/rmx-lt/rmx-backend-probe/internal/config"
	"github.com/rmx-lt/rmx-backend-probe/internal/firmware"
	"github.com/rmx-lt/rmx-backend-probe/internal/protocol"
)

// MQTT transport (paho.golang, plain TCP to the broker on the internal network).
//
//   - when a firmware directory is configured, subscribes to <prefix>/+/fw/req
//     and answers on <prefix>/<client-id>/fw/chunk (binary) or
//     <prefix>/<client-id>/fw/res (JSON), the client id coming from the
//     request topic;
//   - keeps a retained "online" on <prefix>/status/server, replaced by
//     "offline" on clean shutdown or, via the last will, when the connection dies.
//
// The server speaks MQTT 5 (all paho.golang offers); the broker accepts 3.1.1
// and 5 clients side by side, and the firmware scheme needs nothing from v5,
// so small device clients can use either.

const (
	statusOnline  = "online"
	statusOffline = "offline"
	// publishTimeout bounds waiting for the broker to acknowledge a message.
	publishTimeout = 10 * time.Second
)

type mqttClient struct {
	cfg    config.MQTT
	fw     *firmware.Store
	fwGate firmwareGate
	cm     *autopaho.ConnectionManager

	connected atomic.Bool

	// workers (the request handlers) stop with stopWorkers.
	workersCtx  context.Context
	stopWorkers context.CancelFunc
	workers     sync.WaitGroup
}

// startMQTT starts the client in the background. It keeps trying to connect;
// until it has, the health check reports MQTT as down.
func startMQTT(cfg config.MQTT, fw *firmware.Store) *mqttClient {
	m := &mqttClient{cfg: cfg, fw: fw}
	m.workersCtx, m.stopWorkers = context.WithCancel(context.Background())

	acfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{{Scheme: "mqtt", Host: net.JoinHostPort(cfg.Host, strconv.Itoa(int(cfg.Port)))}},
		ConnectUsername:               cfg.Username,
		ConnectPassword:               []byte(cfg.Password),
		KeepAlive:                     30,
		CleanStartOnInitialConnection: true,
		SessionExpiryInterval:         0,
		ConnectTimeout:                10 * time.Second,
		// Wait first so a down broker isn't hammered: 1 s, 2 s, ... up to 30 s.
		ReconnectBackoff: func(attempt int) time.Duration {
			return min(time.Second<<min(attempt, 5), 30*time.Second)
		},
		WillMessage: &paho.WillMessage{
			Topic:   protocol.StatusTopic(cfg.TopicPrefix),
			Payload: []byte(statusOffline),
			QoS:     1,
			Retain:  true,
		},
		OnConnectionUp: func(cm *autopaho.ConnectionManager, _ *paho.Connack) {
			slog.Info("mqtt connected")
			// Must not block. Clean session: subscriptions are renewed on every connect.
			go m.ready(cm)
		},
		OnConnectionDown: func() bool {
			m.connected.Store(false)
			slog.Warn("mqtt connection lost")
			return true
		},
		OnConnectError: func(err error) {
			m.connected.Store(false)
			slog.Warn("mqtt connection error", "error", err)
		},
		ClientConfig: paho.ClientConfig{
			ClientID: cfg.ClientID,
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){
				func(pr paho.PublishReceived) (bool, error) {
					m.workers.Add(1)
					go func() {
						defer m.workers.Done()
						m.dispatch(pr.Packet.Topic, pr.Packet.Payload)
					}()
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
		return m
	}
	m.cm = cm
	return m
}

func (m *mqttClient) isConnected() bool { return m != nil && m.connected.Load() }

// ready subscribes to the firmware requests (when firmware is on) and
// announces the server. Only then is MQTT reported as up.
func (m *mqttClient) ready(cm *autopaho.ConnectionManager) {
	ctx, cancel := context.WithTimeout(m.workersCtx, publishTimeout)
	defer cancel()
	if m.fw != nil {
		subs := []paho.SubscribeOptions{{Topic: protocol.FirmwareRequestFilter(m.cfg.TopicPrefix), QoS: 1}}
		if _, err := cm.Subscribe(ctx, &paho.Subscribe{Subscriptions: subs}); err != nil {
			slog.Error("mqtt subscribe failed", "error", err)
			return
		}
	}
	_, err := cm.Publish(ctx, &paho.Publish{
		Topic:   protocol.StatusTopic(m.cfg.TopicPrefix),
		QoS:     1,
		Retain:  true,
		Payload: []byte(statusOnline),
	})
	if err != nil {
		slog.Error("mqtt status publish failed", "error", err)
		return
	}
	m.connected.Store(true)
}

func (m *mqttClient) dispatch(topic string, payload []byte) {
	if clientID, ok := protocol.ParseFirmwareRequestTopic(m.cfg.TopicPrefix, topic); ok {
		m.handleFirmware(clientID, payload)
		return
	}
	slog.Debug("ignoring message on unexpected topic", "topic", topic)
}

func (m *mqttClient) publish(topic string, payload []byte) error {
	ctx, cancel := context.WithTimeout(m.workersCtx, publishTimeout)
	defer cancel()
	_, err := m.cm.Publish(ctx, &paho.Publish{Topic: topic, QoS: 1, Payload: payload})
	return err
}

// stop marks the server offline and disconnects cleanly. Call it after HTTP is drained.
func (m *mqttClient) stop() {
	m.stopWorkers()
	m.workers.Wait()
	if m.cm == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if m.connected.Swap(false) {
		// A clean disconnect discards the last will, so say it ourselves.
		_, err := m.cm.Publish(ctx, &paho.Publish{
			Topic:   protocol.StatusTopic(m.cfg.TopicPrefix),
			QoS:     1,
			Retain:  true,
			Payload: []byte(statusOffline),
		})
		if err != nil {
			slog.Warn("mqtt offline status failed", "error", err)
		}
	}
	if err := m.cm.Disconnect(ctx); err != nil {
		slog.Warn("mqtt disconnect timed out")
	}
	slog.Info("mqtt stopped")
}
