package transfer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/core"
	"github.com/rmx-lt/rmx-server-app/internal/mqtt"
)

// Set is one of the three topic sets of wiki Mower-Protocol §12: the topic
// prefix below <prefix>/<device>/. Requests come on "<set>/req", chunks go
// out on "<set>/chunk", errors on "<set>/res".
type Set string

const (
	GatewayFirmware   Set = "gateway/fw"
	AutopilotFirmware Set = "autopilot/fw"
	AutopilotJob      Set = "autopilot/job"
)

// Sets lists the three sets.
var Sets = []Set{GatewayFirmware, AutopilotFirmware, AutopilotJob}

// Request is the suffix of the topic the board asks on.
func (s Set) Request() string { return string(s) + "/req" }

// Chunk is the suffix of the topic the chunks go out on.
func (s Set) Chunk() string { return string(s) + "/chunk" }

// Response is the suffix of the topic errors go out on.
func (s Set) Response() string { return string(s) + "/res" }

const (
	// Magic is the first four bytes of every chunk frame ("RMFW").
	Magic = "RMFW"
	// HeaderVersion is the only header version this server writes.
	HeaderVersion byte = 1
	// HeaderSize is the fixed header length, in bytes. The chunk starts here.
	HeaderSize = 64
	// FlagSHA256 means bytes 32:64 of the header are the whole-file SHA-256.
	FlagSHA256 byte = 1
	// MaxRequestBytes bounds a request: a JSON message is at most 4096 bytes (§4).
	MaxRequestBytes = 4096
)

// RequestIDHash is the first 8 bytes of SHA-256 over the raw UTF-8 request id.
// The chunk header echoes it, so a board can match a chunk to its request.
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
	FileSize   uint32
	RequestID  string
	// IDHash is filled by ParseFrame: the 8-byte request id hash from the header.
	IDHash  [8]byte
	SHA256  [32]byte
	Payload []byte
}

// EncodeFrame writes the version-1 header and the chunk (§12.2). A chunk
// longer than the uint16 length field holds is refused.
func EncodeFrame(f Frame) ([]byte, error) {
	if len(f.Payload) > HeaderMaxChunk {
		return nil, fmt.Errorf("chunk is %d bytes, the header holds at most %d", len(f.Payload), HeaderMaxChunk)
	}
	buf := make([]byte, HeaderSize+len(f.Payload))
	copy(buf[0:4], Magic)
	buf[4] = HeaderVersion
	buf[5] = FlagSHA256
	binary.LittleEndian.PutUint16(buf[6:8], HeaderSize)
	binary.LittleEndian.PutUint32(buf[8:12], f.ChunkIndex)
	binary.LittleEndian.PutUint32(buf[12:16], f.ChunkCount)
	binary.LittleEndian.PutUint32(buf[16:20], f.FileSize)
	binary.LittleEndian.PutUint16(buf[20:22], uint16(len(f.Payload)))
	// buf[22:24] stays 0 (reserved).
	hash := RequestIDHash(f.RequestID)
	copy(buf[24:32], hash[:])
	copy(buf[32:64], f.SHA256[:])
	copy(buf[HeaderSize:], f.Payload)
	return buf, nil
}

// ParseFrame reads a frame this server would write, the way a board does: it
// drops a frame whose fixed fields are wrong or whose length does not fit.
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
		FileSize:   binary.LittleEndian.Uint32(b[16:20]),
		IDHash:     idHash,
		SHA256:     sum,
		Payload:    append([]byte(nil), b[HeaderSize:]...),
	}, nil
}

// Request is a request after it has been checked (§12.1).
type Request struct {
	RequestID string
	File      string
	Chunk     uint32
}

// ParseRequest checks a request body. The string is a client-facing reason;
// it is empty when the request is usable. The returned Request carries the
// request id whenever that was valid, so the error can echo it.
func ParseRequest(body []byte) (Request, string) {
	if len(body) > MaxRequestBytes {
		return Request{}, "request is too large"
	}
	var raw map[string]json.RawMessage
	dec := json.NewDecoder(bytes.NewReader(body))
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
	if v, ok := raw["file"]; ok {
		if err := json.Unmarshal(v, &req.File); err != nil {
			return Request{RequestID: req.RequestID}, "file must be a string"
		}
	}
	if !ValidFileName(req.File) {
		return Request{RequestID: req.RequestID}, "file must be 1 to 128 characters of letters, digits, . _ and -"
	}
	v, ok := raw["chunk"]
	if !ok {
		return Request{RequestID: req.RequestID}, "chunk is required"
	}
	n, msg := parseChunk(v)
	if msg != "" {
		return Request{RequestID: req.RequestID}, msg
	}
	req.Chunk = n
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

// ErrorMessage is the JSON answer published on a set's res topic (§12.3).
type ErrorMessage struct {
	RequestID string `json:"request_id"`
	Error     struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// ---- The service ---------------------------------------------------------------

// Service serves the three sets of files. A set whose directory is not
// configured has no files: every request for it is not_found.
type Service struct {
	dirs map[Set]*Dir
}

// Config names the directories. FirmwareDir holds the images in
// subdirectories named after the board ("gateway", "autopilot"); JobDir holds
// the job files. Empty means that set is not served.
type Config struct {
	FirmwareDir string
	JobDir      string
}

// Open opens the directories of the configured sets. A missing firmware
// subdirectory is logged and leaves that set empty; FIRMWARE_DIR and JOB_DIR
// themselves must exist.
func Open(cfg Config) (*Service, error) {
	s := &Service{dirs: map[Set]*Dir{}}
	if cfg.FirmwareDir != "" {
		if _, err := os.Stat(cfg.FirmwareDir); err != nil {
			return nil, fmt.Errorf("FIRMWARE_DIR: %w", err)
		}
		for _, p := range []struct {
			set Set
			sub string
		}{{GatewayFirmware, "gateway"}, {AutopilotFirmware, "autopilot"}} {
			path := filepath.Join(cfg.FirmwareDir, p.sub)
			d, err := OpenDir(path, MaxFirmwareBytes)
			switch {
			case err == nil:
				s.dirs[p.set] = d
				slog.Info("transfer directory ready", "set", string(p.set), "dir", path)
			case errors.Is(err, os.ErrNotExist):
				slog.Warn("transfer directory is missing; the set serves no files", "set", string(p.set), "dir", path)
			default:
				s.Close()
				return nil, fmt.Errorf("%s directory: %w", p.set, err)
			}
		}
	}
	if cfg.JobDir != "" {
		d, err := OpenDir(cfg.JobDir, MaxJobBytes)
		if err != nil {
			s.Close()
			return nil, fmt.Errorf("JOB_DIR: %w", err)
		}
		s.dirs[AutopilotJob] = d
		slog.Info("transfer directory ready", "set", string(AutopilotJob), "dir", cfg.JobDir)
	}
	return s, nil
}

// NewService returns a service over already opened directories.
func NewService(dirs map[Set]*Dir) *Service { return &Service{dirs: dirs} }

// Close closes every directory.
func (s *Service) Close() {
	for _, d := range s.dirs {
		_ = d.Close()
	}
}

// ReadChunk returns chunk index of file in set, and the file's description.
func (s *Service) ReadChunk(set Set, file string, index uint32) (Meta, []byte, error) {
	d, ok := s.dirs[set]
	if !ok {
		if !ValidFileName(file) {
			return Meta{}, nil, ErrBadName
		}
		return Meta{}, nil, ErrNotFound
	}
	return d.ReadChunk(file, index)
}

// ---- The request handler --------------------------------------------------------

// publisher is the part of *mqtt.Client the handler uses.
type publisher interface {
	Publish(ctx context.Context, device core.DeviceID, suffix string, payload []byte) error
}

// RegisterMQTT routes the requests of the three sets (<set>/req) to svc. The
// sets are served side by side: each request runs on its own, so a job file
// and a firmware image download at the same time.
func RegisterMQTT(c *mqtt.Client, svc *Service) {
	h := &mqttHandler{pub: c, svc: svc}
	for _, set := range Sets {
		c.Handle(set.Request(), func(ctx context.Context, device core.DeviceID, payload []byte) {
			h.handle(ctx, set, device, payload)
		})
	}
}

type mqttHandler struct {
	pub  publisher
	svc  *Service
	gate gate
}

type gateKey struct {
	device core.DeviceID
	set    Set
}

// gate allows one request per device and topic set at a time (§12.4: a board
// has one request open per set). A second request that arrives before the
// first answer is published is ignored; the board asks again after its timeout.
type gate struct {
	mu   sync.Mutex
	busy map[gateKey]struct{}
}

func (g *gate) acquire(id core.DeviceID, set Set) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.busy == nil {
		g.busy = map[gateKey]struct{}{}
	}
	k := gateKey{id, set}
	if _, ok := g.busy[k]; ok {
		return false
	}
	g.busy[k] = struct{}{}
	return true
}

func (g *gate) release(id core.DeviceID, set Set) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.busy, gateKey{id, set})
}

func (h *mqttHandler) handle(ctx context.Context, set Set, device core.DeviceID, payload []byte) {
	if !h.gate.acquire(device, set) {
		slog.Debug("ignoring a request while one is in flight", "device", string(device), "set", string(set))
		return
	}
	defer h.gate.release(device, set)

	req, msg := ParseRequest(payload)
	if msg != "" {
		h.publishError(ctx, set, device, req.RequestID, api.CodeBadRequest, msg)
		return
	}
	meta, data, err := h.svc.ReadChunk(set, req.File, req.Chunk)
	if err != nil {
		h.publishFailure(ctx, set, device, req.RequestID, err)
		return
	}
	frame, err := EncodeFrame(Frame{
		ChunkIndex: req.Chunk, ChunkCount: meta.Chunks, FileSize: uint32(meta.Size),
		RequestID: req.RequestID, SHA256: meta.Sum, Payload: data,
	})
	if err != nil {
		slog.Error("encoding a chunk failed", "set", string(set), "error", err)
		h.publishError(ctx, set, device, req.RequestID, api.CodeInternal, "internal error")
		return
	}
	if err := h.pub.Publish(ctx, device, set.Chunk(), frame); err != nil {
		slog.Warn("chunk publish failed", "set", string(set), "error", err)
	}
}

func (h *mqttHandler) publishFailure(ctx context.Context, set Set, device core.DeviceID, requestID string, err error) {
	code, msg := api.CodeInternal, "internal error"
	switch {
	case errors.Is(err, ErrBadName):
		code, msg = api.CodeBadRequest, "file name is not allowed"
	case errors.Is(err, ErrNotFound):
		code, msg = api.CodeNotFound, "no such file"
	case errors.Is(err, ErrBadIndex):
		code, msg = api.CodeBadRequest, "chunk is past the end of the file"
	case errors.Is(err, ErrTooLarge):
		code, msg = api.CodeInternal, "file is too large"
	default:
		slog.Error("transfer request failed", "set", string(set), "error", err, "device", string(device))
	}
	h.publishError(ctx, set, device, requestID, code, msg)
}

func (h *mqttHandler) publishError(ctx context.Context, set Set, device core.DeviceID, requestID string, code api.ErrorCode, message string) {
	var body ErrorMessage
	body.RequestID = requestID
	body.Error.Code = string(code)
	body.Error.Message = message
	out, err := json.Marshal(body)
	if err != nil {
		slog.Error("encoding a transfer error failed", "error", err)
		return
	}
	if err := h.pub.Publish(ctx, device, set.Response(), out); err != nil {
		slog.Warn("transfer error publish failed", "set", string(set), "error", err)
	}
}
