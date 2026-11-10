package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"sync"

	"github.com/rmx-lt/rmx-backend-probe/internal/firmware"
	"github.com/rmx-lt/rmx-backend-probe/internal/protocol"
)

// firmwareGate allows one firmware request per device at a time. A second
// request that arrives before the first answer is published is ignored.
type firmwareGate struct {
	mu   sync.Mutex
	busy map[string]struct{}
}

func (g *firmwareGate) acquire(id string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.busy == nil {
		g.busy = map[string]struct{}{}
	}
	if _, ok := g.busy[id]; ok {
		return false
	}
	g.busy[id] = struct{}{}
	return true
}

func (g *firmwareGate) release(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.busy, id)
}

func (m *mqttClient) handleFirmware(clientID string, payload []byte) {
	if m.fw == nil {
		m.publishFirmwareError(clientID, "", protocol.CodeInternal, "firmware is not configured")
		return
	}
	if !m.fwGate.acquire(clientID) {
		slog.Debug("ignoring firmware request while one is in flight", "client", clientID)
		return
	}
	defer m.fwGate.release(clientID)

	req, msg := firmware.ParseRequest(payload)
	if msg != "" {
		m.publishFirmwareError(clientID, req.RequestID, protocol.CodeBadRequest, msg)
		return
	}
	switch req.Op {
	case "info":
		meta, err := m.fw.Stat(req.File)
		if err != nil {
			m.publishFirmwareFailure(clientID, req.RequestID, err)
			return
		}
		body, err := json.Marshal(firmware.Info{
			RequestID: req.RequestID, Op: "info", File: meta.Name,
			Size: meta.Size, SHA256: meta.SumHex(), ChunkSize: meta.ChunkSize, Chunks: meta.Chunks,
		})
		if err != nil {
			slog.Error("encoding a firmware info response failed", "error", err)
			return
		}
		if err := m.publish(protocol.FirmwareResponseTopic(m.cfg.TopicPrefix, clientID), body); err != nil {
			slog.Warn("firmware info publish failed", "error", err)
		}
	case "chunk":
		meta, data, err := m.fw.ReadChunk(req.File, req.Chunk)
		if err != nil {
			m.publishFirmwareFailure(clientID, req.RequestID, err)
			return
		}
		frame, err := firmware.EncodeFrame(firmware.Frame{
			ChunkIndex: req.Chunk, ChunkCount: meta.Chunks, ImageSize: uint32(meta.Size),
			RequestID: req.RequestID, SHA256: meta.Sum, Payload: data,
		})
		if err != nil {
			slog.Error("encoding a firmware chunk failed", "error", err)
			m.publishFirmwareError(clientID, req.RequestID, protocol.CodeInternal, "internal error")
			return
		}
		if err := m.publish(protocol.FirmwareChunkTopic(m.cfg.TopicPrefix, clientID), frame); err != nil {
			slog.Warn("firmware chunk publish failed", "error", err)
		}
	default:
		m.publishFirmwareError(clientID, req.RequestID, protocol.CodeBadRequest, "op must be chunk or info")
	}
}

func (m *mqttClient) publishFirmwareFailure(clientID, requestID string, err error) {
	code, msg := protocol.CodeInternal, "internal error"
	switch {
	case errors.Is(err, firmware.ErrBadName):
		code, msg = protocol.CodeBadRequest, "file must match [A-Za-z0-9._-]+.bin"
	case errors.Is(err, firmware.ErrNotFound):
		code, msg = protocol.CodeNotFound, "unknown firmware file"
	case errors.Is(err, firmware.ErrBadIndex):
		code, msg = protocol.CodeBadRequest, "chunk is past the end of the file"
	case errors.Is(err, firmware.ErrTooLarge):
		code, msg = protocol.CodeInternal, "firmware file is larger than 32 MiB"
	default:
		slog.Error("firmware request failed", "error", err, "client", clientID)
	}
	m.publishFirmwareError(clientID, requestID, code, msg)
}

func (m *mqttClient) publishFirmwareError(clientID, requestID string, code protocol.ErrorCode, message string) {
	var body firmware.ErrorMessage
	body.RequestID = requestID
	body.Error.Code = string(code)
	body.Error.Message = message
	out, err := json.Marshal(body)
	if err != nil {
		slog.Error("encoding a firmware error failed", "error", err)
		return
	}
	if err := m.publish(protocol.FirmwareResponseTopic(m.cfg.TopicPrefix, clientID), out); err != nil {
		slog.Warn("firmware error publish failed", "error", err)
	}
}
