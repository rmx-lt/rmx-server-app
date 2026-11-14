package firmware

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/mqtt"
)

// Topic suffixes under <prefix>/<device>/ (see the mqtt package for the grammar).
const (
	// SuffixRequest: device to server, firmware request (JSON).
	SuffixRequest = "fw/req"
	// SuffixChunk: server to device, one firmware chunk (binary).
	SuffixChunk = "fw/chunk"
	// SuffixResponse: server to device, firmware info or error (JSON).
	SuffixResponse = "fw/res"
)

const (
	// Magic is the first four bytes of every chunk frame ("RMFW").
	Magic = "RMFW"
	// HeaderVersion is the only header version this server writes.
	HeaderVersion byte = 1
	// HeaderSize is the fixed header length, in bytes. The payload starts here.
	HeaderSize = 64
	// FlagSHA256 means bytes 32:64 of the header are the whole-image SHA-256.
	FlagSHA256 byte = 1
	// MaxRequestBytes bounds a firmware request JSON body.
	MaxRequestBytes = 1024

	opChunk = "chunk"
	opInfo  = "info"
)

// RequestIDHash is the first 8 bytes of SHA-256 over the raw UTF-8 request id.
// It is what the chunk header echoes, so a device can match a frame to the
// request it sent.
func RequestIDHash(requestID string) [8]byte {
	sum := sha256.Sum256([]byte(requestID))
	var out [8]byte
	copy(out[:], sum[:8])
	return out
}

// Frame is the fixed header in front of one chunk's raw bytes.
type Frame struct {
	ChunkIndex uint32
	ChunkCount uint32
	ImageSize  uint32
	RequestID  string
	// IDHash is filled by ParseFrame: the 8-byte request id hash from the header.
	IDHash  [8]byte
	SHA256  [32]byte
	Payload []byte
}

// EncodeFrame writes the version-1 header and payload. Payload longer than
// MaxChunkBytes is refused: the length field is a uint16.
func EncodeFrame(f Frame) ([]byte, error) {
	if len(f.Payload) > MaxChunkBytes {
		return nil, fmt.Errorf("chunk is %d bytes, the header holds at most %d", len(f.Payload), MaxChunkBytes)
	}
	buf := make([]byte, HeaderSize+len(f.Payload))
	copy(buf[0:4], Magic)
	buf[4] = HeaderVersion
	buf[5] = FlagSHA256
	binary.LittleEndian.PutUint16(buf[6:8], HeaderSize)
	binary.LittleEndian.PutUint32(buf[8:12], f.ChunkIndex)
	binary.LittleEndian.PutUint32(buf[12:16], f.ChunkCount)
	binary.LittleEndian.PutUint32(buf[16:20], f.ImageSize)
	binary.LittleEndian.PutUint16(buf[20:22], uint16(len(f.Payload)))
	// buf[22:24] stays 0 (reserved).
	hash := RequestIDHash(f.RequestID)
	copy(buf[24:32], hash[:])
	copy(buf[32:64], f.SHA256[:])
	copy(buf[HeaderSize:], f.Payload)
	return buf, nil
}

// ParseFrame reads a frame this server would write. It is for tests and for
// anyone checking a frame against the contract. A version other than 1, or a
// header_len other than HeaderSize, is rejected.
func ParseFrame(b []byte) (Frame, error) {
	if len(b) < HeaderSize {
		return Frame{}, errors.New("frame is shorter than the header")
	}
	if string(b[0:4]) != Magic {
		return Frame{}, errors.New("frame magic is not RMFW")
	}
	if b[4] != HeaderVersion {
		return Frame{}, fmt.Errorf("frame version %d is not %d", b[4], HeaderVersion)
	}
	if b[5] != FlagSHA256 {
		return Frame{}, errors.New("frame flags are not the SHA-256 flag")
	}
	if binary.LittleEndian.Uint16(b[6:8]) != HeaderSize {
		return Frame{}, errors.New("frame header length is not 64")
	}
	n := binary.LittleEndian.Uint16(b[20:22])
	if len(b) != HeaderSize+int(n) {
		return Frame{}, errors.New("frame length does not match the chunk length")
	}
	if binary.LittleEndian.Uint16(b[22:24]) != 0 {
		return Frame{}, errors.New("frame reserved field is not 0")
	}
	var sum [32]byte
	copy(sum[:], b[32:64])
	var idHash [8]byte
	copy(idHash[:], b[24:32])
	return Frame{
		ChunkIndex: binary.LittleEndian.Uint32(b[8:12]),
		ChunkCount: binary.LittleEndian.Uint32(b[12:16]),
		ImageSize:  binary.LittleEndian.Uint32(b[16:20]),
		IDHash:     idHash,
		SHA256:     sum,
		Payload:    append([]byte(nil), b[HeaderSize:]...),
	}, nil
}

// Request is a firmware request after it has been checked.
type Request struct {
	RequestID string
	// Op is "chunk" or "info".
	Op   string
	File string
	// Chunk is set for Op chunk.
	Chunk uint32
}

// ParseRequest checks a firmware request body. The string is a client-facing
// reason; it is empty when the request is usable. An unusable request id is
// not echoed back by the caller.
func ParseRequest(body []byte) (Request, string) {
	if len(body) > MaxRequestBytes {
		return Request{}, "request is too large"
	}
	var raw map[string]json.RawMessage
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil || raw == nil {
		return Request{}, "request is not valid JSON"
	}
	if dec.More() {
		return Request{}, "request is not valid JSON"
	}
	var req Request
	if v, ok := raw["request_id"]; ok {
		if err := json.Unmarshal(v, &req.RequestID); err != nil {
			return Request{}, "request_id must be a string"
		}
	}
	if !core.ValidID(req.RequestID) {
		return Request{}, "request_id must be 1 to 64 characters of letters, digits, _ and -"
	}
	req.Op = opChunk
	if v, ok := raw["op"]; ok {
		if err := json.Unmarshal(v, &req.Op); err != nil || (req.Op != opChunk && req.Op != opInfo) {
			return Request{RequestID: req.RequestID}, "op must be chunk or info"
		}
	}
	if v, ok := raw["file"]; ok {
		if err := json.Unmarshal(v, &req.File); err != nil {
			return Request{RequestID: req.RequestID}, "file must be a string"
		}
	}
	if !ValidFileName(req.File) {
		return Request{RequestID: req.RequestID}, "file must match [A-Za-z0-9._-]+.bin"
	}
	if req.Op == opChunk {
		v, ok := raw["chunk"]
		if !ok {
			return Request{RequestID: req.RequestID}, "chunk is required"
		}
		n, msg := parseChunk(v)
		if msg != "" {
			return Request{RequestID: req.RequestID}, msg
		}
		req.Chunk = n
	}
	return req, ""
}

func parseChunk(v json.RawMessage) (uint32, string) {
	s := bytes.TrimSpace(v)
	if len(s) == 0 || s[0] < '0' || s[0] > '9' {
		return 0, "chunk must be an integer from 0"
	}
	i, err := strconv.ParseUint(string(s), 10, 32)
	if err != nil {
		return 0, "chunk must be an integer from 0"
	}
	return uint32(i), ""
}

// Info is the JSON answer to an "info" request.
type Info struct {
	RequestID string `json:"request_id"`
	Op        string `json:"op"`
	File      string `json:"file"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
	ChunkSize int    `json:"chunk_size"`
	Chunks    uint32 `json:"chunks"`
}

// ErrorMessage is the JSON answer published on the firmware response topic.
type ErrorMessage struct {
	RequestID string `json:"request_id"`
	Error     struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// ---- The request handler ------------------------------------------------------

// publisher is the part of *mqtt.Client the handler uses.
type publisher interface {
	Publish(ctx context.Context, device core.DeviceID, suffix string, payload []byte) error
}

// RegisterMQTT routes firmware requests (<prefix>/<device>/fw/req) to svc.
// Call it only when firmware is configured: without it, the server does not
// subscribe to the requests at all.
func RegisterMQTT(c *mqtt.Client, svc *Service) {
	h := &mqttHandler{pub: c, fw: svc}
	c.Handle(SuffixRequest, h.handle)
}

type mqttHandler struct {
	pub  publisher
	fw   *Service
	gate gate
}

// gate allows one firmware request per device at a time. A second
// request that arrives before the first answer is published is ignored.
type gate struct {
	mu   sync.Mutex
	busy map[core.DeviceID]struct{}
}

func (g *gate) acquire(id core.DeviceID) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.busy == nil {
		g.busy = map[core.DeviceID]struct{}{}
	}
	if _, ok := g.busy[id]; ok {
		return false
	}
	g.busy[id] = struct{}{}
	return true
}

func (g *gate) release(id core.DeviceID) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.busy, id)
}

func (h *mqttHandler) handle(ctx context.Context, device core.DeviceID, payload []byte) {
	if h.fw == nil {
		h.publishError(ctx, device, "", api.CodeInternal, "firmware is not configured")
		return
	}
	if !h.gate.acquire(device) {
		slog.Debug("ignoring firmware request while one is in flight", "client", device)
		return
	}
	defer h.gate.release(device)

	req, msg := ParseRequest(payload)
	if msg != "" {
		h.publishError(ctx, device, req.RequestID, api.CodeBadRequest, msg)
		return
	}
	switch req.Op {
	case opInfo:
		meta, err := h.fw.Stat(req.File)
		if err != nil {
			h.publishFailure(ctx, device, req.RequestID, err)
			return
		}
		body, err := json.Marshal(Info{
			RequestID: req.RequestID, Op: opInfo, File: meta.Name,
			Size: meta.Size, SHA256: meta.SumHex(), ChunkSize: meta.ChunkSize, Chunks: meta.Chunks,
		})
		if err != nil {
			slog.Error("encoding a firmware info response failed", "error", err)
			return
		}
		if err := h.pub.Publish(ctx, device, SuffixResponse, body); err != nil {
			slog.Warn("firmware info publish failed", "error", err)
		}
	case opChunk:
		meta, data, err := h.fw.ReadChunk(req.File, req.Chunk)
		if err != nil {
			h.publishFailure(ctx, device, req.RequestID, err)
			return
		}
		frame, err := EncodeFrame(Frame{
			ChunkIndex: req.Chunk, ChunkCount: meta.Chunks, ImageSize: uint32(meta.Size),
			RequestID: req.RequestID, SHA256: meta.Sum, Payload: data,
		})
		if err != nil {
			slog.Error("encoding a firmware chunk failed", "error", err)
			h.publishError(ctx, device, req.RequestID, api.CodeInternal, "internal error")
			return
		}
		if err := h.pub.Publish(ctx, device, SuffixChunk, frame); err != nil {
			slog.Warn("firmware chunk publish failed", "error", err)
		}
	default:
		h.publishError(ctx, device, req.RequestID, api.CodeBadRequest, "op must be chunk or info")
	}
}

func (h *mqttHandler) publishFailure(ctx context.Context, device core.DeviceID, requestID string, err error) {
	code, msg := api.CodeInternal, "internal error"
	switch {
	case errors.Is(err, ErrBadName):
		code, msg = api.CodeBadRequest, "file must match [A-Za-z0-9._-]+.bin"
	case errors.Is(err, ErrNotFound):
		code, msg = api.CodeNotFound, "unknown firmware file"
	case errors.Is(err, ErrBadIndex):
		code, msg = api.CodeBadRequest, "chunk is past the end of the file"
	case errors.Is(err, ErrTooLarge):
		code, msg = api.CodeInternal, "firmware file is larger than 32 MiB"
	default:
		slog.Error("firmware request failed", "error", err, "client", device)
	}
	h.publishError(ctx, device, requestID, code, msg)
}

func (h *mqttHandler) publishError(ctx context.Context, device core.DeviceID, requestID string, code api.ErrorCode, message string) {
	var body ErrorMessage
	body.RequestID = requestID
	body.Error.Code = string(code)
	body.Error.Message = message
	out, err := json.Marshal(body)
	if err != nil {
		slog.Error("encoding a firmware error failed", "error", err)
		return
	}
	if err := h.pub.Publish(ctx, device, SuffixResponse, out); err != nil {
		slog.Warn("firmware error publish failed", "error", err)
	}
}
