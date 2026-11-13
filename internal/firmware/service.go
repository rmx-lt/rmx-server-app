// Package firmware serves signed firmware images to a device as MQTT chunks.
//
// The device checks the image signature itself. This domain only reads a
// file out of a directory, splits it into chunks, and builds the binary
// frame. The topic layout and the byte layout are the contract in wiki
// Server-App, section "Firmware over MQTT".
//
// Files: service.go (this: the image directory), mqtt.go (the device
// payloads, the topic suffixes and the request handler). Firmware has no
// table, so no store.go.
package firmware

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/config"
)

const (
	// DefaultChunkBytes is the chunk size when FIRMWARE_CHUNK_BYTES is unset.
	DefaultChunkBytes = config.DefaultFirmwareChunkBytes
	// MinChunkBytes and MaxChunkBytes bound FIRMWARE_CHUNK_BYTES.
	// Max fits in the uint16 chunk length of the header.
	MinChunkBytes = config.MinFirmwareChunkBytes
	MaxChunkBytes = config.MaxFirmwareChunkBytes
	// MaxImageBytes is the largest file this server will send (32 MiB).
	MaxImageBytes int64 = 32 << 20
	// MaxFileNameLen bounds a firmware file name.
	MaxFileNameLen = 128
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

// Service reads images from one directory. The directory is opened with
// os.Root, so a name cannot escape it.
type Service struct {
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
func Open(dir string, chunkBytes int) (*Service, error) {
	if chunkBytes < MinChunkBytes || chunkBytes > MaxChunkBytes {
		return nil, fmt.Errorf("firmware chunk size %d is outside %d..%d", chunkBytes, MinChunkBytes, MaxChunkBytes)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("FIRMWARE_DIR: %w", err)
	}
	return &Service{root: root, chunk: chunkBytes, cache: map[string]digest{}}, nil
}

// Close closes the directory.
func (s *Service) Close() error { return s.root.Close() }

// ChunkBytes is the configured chunk size.
func (s *Service) ChunkBytes() int { return s.chunk }

// Stat returns the description of name, including the whole-image SHA-256.
func (s *Service) Stat(name string) (Meta, error) {
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
func (s *Service) ReadChunk(name string, index uint32) (Meta, []byte, error) {
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

func (s *Service) open(name string) (*os.File, os.FileInfo, error) {
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

func (s *Service) meta(name string, f *os.File, info os.FileInfo) (Meta, error) {
	sum, err := s.sum(name, f, info)
	if err != nil {
		return Meta{}, err
	}
	return Meta{
		Name: name, Size: info.Size(), Chunks: ChunkCount(info.Size(), s.chunk),
		ChunkSize: s.chunk, Sum: sum,
	}, nil
}

func (s *Service) sum(name string, f *os.File, info os.FileInfo) ([32]byte, error) {
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
