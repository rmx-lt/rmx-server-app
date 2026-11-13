// Package firmware serves signed firmware images to a device as MQTT chunks.
//
// The device checks the image signature itself. This package only reads a
// file out of a directory, splits it into chunks, and builds the binary
// frame. The topic layout and the byte layout are the contract in wiki
// Server-App, section "Firmware over MQTT".
package firmware

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/protocol"
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

	// DefaultChunkBytes is the chunk size when FIRMWARE_CHUNK_BYTES is unset.
	DefaultChunkBytes = 4096
	// MinChunkBytes and MaxChunkBytes bound FIRMWARE_CHUNK_BYTES.
	// Max fits in the uint16 chunk length of the header.
	MinChunkBytes = 256
	MaxChunkBytes = 16384
	// MaxImageBytes is the largest file this server will send (32 MiB).
	MaxImageBytes int64 = 32 << 20
	// MaxFileNameLen bounds a firmware file name.
	MaxFileNameLen = 128
	// MaxRequestBytes bounds a firmware request JSON body.
	MaxRequestBytes = 1024

	opChunk = "chunk"
	opInfo  = "info"
)

// fileName is the only accepted firmware file name: one path segment ending
// in .bin. Slashes and backslashes cannot match, so the name cannot be a path.
var fileName = regexp.MustCompile(`^[A-Za-z0-9._-]+\.bin$`)

var (
	// ErrBadName is a file name that is not a single *.bin segment.
	ErrBadName = errors.New("bad firmware file name")
	// ErrNotFound is a name that is not a regular file in the directory.
	ErrNotFound = errors.New("firmware file not found")
	// ErrTooLarge is a file over MaxImageBytes.
	ErrTooLarge = errors.New("firmware file is too large")
	// ErrBadIndex is a chunk index at or past the chunk count.
	ErrBadIndex = errors.New("firmware chunk index is past the end")
)

// ValidFileName reports whether name is a single firmware file name.
func ValidFileName(name string) bool {
	return len(name) <= MaxFileNameLen && fileName.MatchString(name)
}

// ChunkCount is how many chunks a file of size bytes splits into.
// An empty file is one chunk of length 0, so the device still receives the
// header (and the SHA-256 of empty input).
func ChunkCount(size int64, chunkBytes int) uint32 {
	if size <= 0 {
		return 1
	}
	cs := int64(chunkBytes)
	n := (size + cs - 1) / cs
	if n > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(n)
}

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
	if !protocol.ValidClientID(req.RequestID) {
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

// Meta describes one image in the firmware directory.
type Meta struct {
	Name      string
	Size      int64
	Chunks    uint32
	ChunkSize int
	Sum       [32]byte
}

// SumHex is the lower-case hex of the whole-image SHA-256.
func (m Meta) SumHex() string { return hex.EncodeToString(m.Sum[:]) }

// Store reads images from one directory. The directory is opened with
// os.Root, so a name cannot escape it.
type Store struct {
	root  *os.Root
	chunk int

	mu    sync.Mutex
	cache map[string]digest
}

type digest struct {
	size int64
	mod  time.Time
	sum  [32]byte
}

// Open opens dir for reading. chunkBytes is the size of every chunk except
// the last, which is shorter. dir must already exist.
func Open(dir string, chunkBytes int) (*Store, error) {
	if chunkBytes < MinChunkBytes || chunkBytes > MaxChunkBytes {
		return nil, fmt.Errorf("firmware chunk size %d is outside %d..%d", chunkBytes, MinChunkBytes, MaxChunkBytes)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("FIRMWARE_DIR: %w", err)
	}
	return &Store{root: root, chunk: chunkBytes, cache: map[string]digest{}}, nil
}

// Close closes the directory.
func (s *Store) Close() error { return s.root.Close() }

// ChunkBytes is the configured chunk size.
func (s *Store) ChunkBytes() int { return s.chunk }

// Stat returns the description of name, including the whole-image SHA-256.
func (s *Store) Stat(name string) (Meta, error) {
	f, info, err := s.open(name)
	if err != nil {
		return Meta{}, err
	}
	defer f.Close()
	return s.meta(name, f, info)
}

// ReadChunk returns chunk index of name and the image description.
// The last chunk is shorter than the configured chunk size. Index 0 of an
// empty file returns a zero-length payload and no error.
func (s *Store) ReadChunk(name string, index uint32) (Meta, []byte, error) {
	f, info, err := s.open(name)
	if err != nil {
		return Meta{}, nil, err
	}
	defer f.Close()
	meta, err := s.meta(name, f, info)
	if err != nil {
		return Meta{}, nil, err
	}
	if index >= meta.Chunks {
		return meta, nil, ErrBadIndex
	}
	if info.Size() == 0 {
		return meta, []byte{}, nil
	}
	offset := int64(index) * int64(s.chunk)
	n := int(info.Size() - offset)
	if n > s.chunk {
		n = s.chunk
	}
	buf := make([]byte, n)
	got, err := f.ReadAt(buf, offset)
	if got != n || (err != nil && !errors.Is(err, io.EOF)) {
		if err == nil {
			err = io.ErrUnexpectedEOF
		}
		return Meta{}, nil, err
	}
	return meta, buf, nil
}

func (s *Store) open(name string) (*os.File, os.FileInfo, error) {
	if !ValidFileName(name) {
		return nil, nil, ErrBadName
	}
	f, err := s.root.Open(name)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		f.Close()
		return nil, nil, ErrNotFound
	}
	if info.Size() > MaxImageBytes {
		f.Close()
		return nil, nil, ErrTooLarge
	}
	return f, info, nil
}

func (s *Store) meta(name string, f *os.File, info os.FileInfo) (Meta, error) {
	sum, err := s.sum(name, f, info)
	if err != nil {
		return Meta{}, err
	}
	return Meta{
		Name: name, Size: info.Size(), Chunks: ChunkCount(info.Size(), s.chunk),
		ChunkSize: s.chunk, Sum: sum,
	}, nil
}

func (s *Store) sum(name string, f *os.File, info os.FileInfo) ([32]byte, error) {
	s.mu.Lock()
	if c, ok := s.cache[name]; ok && c.size == info.Size() && c.mod.Equal(info.ModTime()) {
		s.mu.Unlock()
		return c.sum, nil
	}
	s.mu.Unlock()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return [32]byte{}, err
	}
	var sum [32]byte
	copy(sum[:], h.Sum(nil))

	s.mu.Lock()
	s.cache[name] = digest{size: info.Size(), mod: info.ModTime(), sum: sum}
	s.mu.Unlock()
	return sum, nil
}
