package server

import (
	"context"
	"encoding/json"
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
	"github.com/rmx-lt/rmx-backend-probe/internal/records"
)

// MQTT transport (paho.golang, plain TCP to the broker on the internal network).
//
//   - subscribes to <prefix>/+/req and answers each request on
//     <prefix>/<client-id>/res (the client id comes from the request topic);
//   - when a firmware directory is configured, subscribes to <prefix>/+/fw/req
//     and answers on <prefix>/<client-id>/fw/chunk (binary) or
//     <prefix>/<client-id>/fw/res (JSON);
//   - publishes every change event on <prefix>/events/records;
//   - keeps a retained "online" on <prefix>/status/server, replaced by
//     "offline" on clean shutdown or, via the last will, when the connection dies.
//
// The server speaks MQTT 5 (all paho.golang offers); the broker accepts 3.1.1
// and 5 clients side by side, and the request/response scheme needs nothing
// from v5, so small device clients can use either.

const (
	statusOnline  = "online"
	statusOffline = "offline"
	// publishTimeout bounds waiting for the broker to acknowledge a message.
	publishTimeout = 10 * time.Second
	// handleTimeout bounds one request received over MQTT.
	handleTimeout = 30 * time.Second
)

type mqttClient struct {
	cfg     config.MQTT
	records *records.Service
	fw      *firmware.Store
	fwGate  firmwareGate
	cm      *autopaho.ConnectionManager

	connected atomic.Bool

	// workers (the event forwarder and request handlers) stop with stopWorkers.
	workersCtx  context.Context
	stopWorkers context.CancelFunc
	workers     sync.WaitGroup
}

// startMQTT starts the client in the background. It keeps trying to connect;
// until it has, the health check reports MQTT as down.
func startMQTT(cfg config.MQTT, svc *records.Service, fw *firmware.Store) *mqttClient {
	m := &mqttClient{cfg: cfg, records: svc, fw: fw}
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
	m.workers.Add(1)
	go func() {
		defer m.workers.Done()
		m.forwardEvents()
	}()
	return m
}

func (m *mqttClient) isConnected() bool { return m != nil && m.connected.Load() }

// ready subscribes to the requests and announces the server. Only then is MQTT
// reported as up.
func (m *mqttClient) ready(cm *autopaho.ConnectionManager) {
	ctx, cancel := context.WithTimeout(m.workersCtx, publishTimeout)
	defer cancel()
	subs := []paho.SubscribeOptions{{Topic: protocol.RequestFilter(m.cfg.TopicPrefix), QoS: 1}}
	if m.fw != nil {
		subs = append(subs, paho.SubscribeOptions{Topic: protocol.FirmwareRequestFilter(m.cfg.TopicPrefix), QoS: 1})
	}
	_, err := cm.Subscribe(ctx, &paho.Subscribe{Subscriptions: subs})
	if err != nil {
		slog.Error("mqtt subscribe failed", "error", err)
		return
	}
	_, err = cm.Publish(ctx, &paho.Publish{
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
	if clientID, ok := protocol.ParseRequestTopic(m.cfg.TopicPrefix, topic); ok {
		m.handleRequest(clientID, payload)
		return
	}
	if clientID, ok := protocol.ParseFirmwareRequestTopic(m.cfg.TopicPrefix, topic); ok {
		m.handleFirmware(clientID, payload)
		return
	}
	slog.Debug("ignoring message on unexpected topic", "topic", topic)
}

func (m *mqttClient) handleRequest(clientID string, payload []byte) {
	var response protocol.ResponseEnvelope
	if env, failure := ParseRequest(payload); failure != nil {
		response = *failure
	} else {
		ctx, cancel := context.WithTimeout(m.workersCtx, handleTimeout)
		defer cancel()
		// No IP: the broker doesn't pass on the client's address.
		src := records.Source{Via: protocol.ConnMQTT}
		response = protocol.ResponseEnvelope{RequestID: env.RequestID, Result: m.records.Handle(ctx, src, env.Request)}
	}
	body, err := json.Marshal(response)
	if err != nil {
		slog.Error("encoding an mqtt response failed", "error", err)
		return
	}
	if err := m.publish(protocol.ResponseTopic(m.cfg.TopicPrefix, clientID), body); err != nil {
		slog.Warn("mqtt response publish failed", "error", err)
	}
}

func (m *mqttClient) publish(topic string, payload []byte) error {
	ctx, cancel := context.WithTimeout(m.workersCtx, publishTimeout)
	defer cancel()
	_, err := m.cm.Publish(ctx, &paho.Publish{Topic: topic, QoS: 1, Payload: payload})
	return err
}

// forwardEvents publishes every change event (from any transport) to the events topic.
func (m *mqttClient) forwardEvents() {
	topic := protocol.EventsTopic(m.cfg.TopicPrefix)
	for m.workersCtx.Err() == nil {
		sub := m.records.Subscribe()
		m.forwardFrom(sub, topic)
		if sub.Lagged() {
			slog.Warn("mqtt event forwarder lagged")
		}
	}
}

// forwardFrom publishes the subscription's events until it ends or the workers stop.
func (m *mqttClient) forwardFrom(sub *records.Subscription, topic string) {
	defer sub.Close()
	for {
		select {
		case event, ok := <-sub.C:
			if !ok {
				return
			}
			body, err := json.Marshal(event)
			if err != nil {
				slog.Error("encoding an mqtt event failed", "error", err)
				continue
			}
			// While the broker is down the event is simply not delivered over
			// MQTT (clients resync on reconnect), and nothing waits for it.
			if !m.connected.Load() {
				continue
			}
			if err := m.publish(topic, body); err != nil {
				slog.Warn("mqtt event publish failed", "error", err)
			}
		case <-m.workersCtx.Done():
			return
		}
	}
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
