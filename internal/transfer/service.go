// Package transfer serves files to the mower's boards as MQTT chunks (wiki
// Mower-Protocol §12): signed firmware images for the gateway and for the
// autopilot, and the autopilot's job files.
//
// The board checks the image signature and the job file itself. This domain
// only reads a file out of a directory, splits it into 4096-byte chunks and
// builds the binary frame. Each topic set (gateway/fw, autopilot/fw,
// autopilot/job) has its own directory, so a request on one set can only
// reach that set's files. The topic layout and the byte layout are the
// contract; the server's side is in wiki Server-App, "Chunk transfer".
//
// Files: service.go (the directories), mqtt.go (the device payloads, the topic
// sets and the request handler). Transfer has no table, so no store.go.
package transfer

import (
	"crypto/sha256"
	"errors"
	"io"
	"math"
	"os"
	"regexp"
	"sync"
	"time"
)

const (
	// ChunkBytes is the size of every chunk but the last (§12.2).
	ChunkBytes = 4096
	// HeaderMaxChunk is what the uint16 chunk length of the header can hold.
	HeaderMaxChunk = math.MaxUint16
	// MaxFirmwareBytes is the largest firmware image this server sends (32 MiB).
	MaxFirmwareBytes int64 = 32 << 20
	// MaxJobBytes is the largest job file (1 MiB, §11).
	MaxJobBytes int64 = 1 << 20
	// MaxFileNameLen bounds a file name (§12).
	MaxFileNameLen = 128
)

// fileName is the only accepted file name: 1 to 128 characters of
// [A-Za-z0-9._-]. Slashes and backslashes cannot match, so it is never a path.
var fileName = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

var (
	// ErrBadName is a file name that is not allowed.
	ErrBadName = errors.New("bad file name")
	// ErrNotFound is a name that is not a regular file in the set's directory.
	ErrNotFound = errors.New("file not found")
	// ErrTooLarge is a file over the set's size limit.
	ErrTooLarge = errors.New("file is too large")
	// ErrBadIndex is a chunk number at or past the chunk count.
	ErrBadIndex = errors.New("chunk number is past the end")
)

// ValidFileName reports whether name is an allowed file name: 1 to 128
// characters of [A-Za-z0-9._-], and not "." or "..".
func ValidFileName(name string) bool {
	return len(name) <= MaxFileNameLen && name != "." && name != ".." && fileName.MatchString(name)
}

// ChunkCount is how many chunks a file of size bytes splits into. An empty
// file is one chunk of length 0, so the board still gets the header (and the
// SHA-256 of empty input).
func ChunkCount(size int64) uint32 {
	if size <= 0 {
		return 1
	}
	n := (size + ChunkBytes - 1) / ChunkBytes
	if n > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(n)
}

// Meta describes one file.
type Meta struct {
	Name   string
	Size   int64
	Chunks uint32
	Sum    [32]byte
}

// Dir reads files from one directory. The directory is opened with os.Root,
// so a name cannot escape it.
type Dir struct {
	root *os.Root
	max  int64

	mu    sync.Mutex
	cache map[string]digest
}

type digest struct {
	size int64
	mod  time.Time
	sum  [32]byte
}

// OpenDir opens dir for reading files of at most max bytes. dir must exist.
func OpenDir(dir string, max int64) (*Dir, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &Dir{root: root, max: max, cache: map[string]digest{}}, nil
}

// Close closes the directory.
func (d *Dir) Close() error { return d.root.Close() }

// Stat returns the description of name, including the whole-file SHA-256.
func (d *Dir) Stat(name string) (Meta, error) {
	f, info, err := d.open(name)
	if err != nil {
		return Meta{}, err
	}
	defer f.Close()
	return d.meta(name, f, info)
}

// ReadChunk returns chunk index of name and the file's description. The last
// chunk is shorter than ChunkBytes. Chunk 0 of an empty file is a zero-length
// payload and no error.
func (d *Dir) ReadChunk(name string, index uint32) (Meta, []byte, error) {
	f, info, err := d.open(name)
	if err != nil {
		return Meta{}, nil, err
	}
	defer f.Close()
	meta, err := d.meta(name, f, info)
	if err != nil {
		return Meta{}, nil, err
	}
	if index >= meta.Chunks {
		return meta, nil, ErrBadIndex
	}
	if info.Size() == 0 {
		return meta, []byte{}, nil
	}
	offset := int64(index) * ChunkBytes
	n := int(min(info.Size()-offset, ChunkBytes))
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

func (d *Dir) open(name string) (*os.File, os.FileInfo, error) {
	if !ValidFileName(name) {
		return nil, nil, ErrBadName
	}
	f, err := d.root.Open(name)
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
	if info.Size() > d.max {
		f.Close()
		return nil, nil, ErrTooLarge
	}
	return f, info, nil
}

func (d *Dir) meta(name string, f *os.File, info os.FileInfo) (Meta, error) {
	sum, err := d.sum(name, f, info)
	if err != nil {
		return Meta{}, err
	}
	return Meta{Name: name, Size: info.Size(), Chunks: ChunkCount(info.Size()), Sum: sum}, nil
}

// sum is the SHA-256 of the file, cached until its size or modification time changes.
func (d *Dir) sum(name string, f *os.File, info os.FileInfo) ([32]byte, error) {
	d.mu.Lock()
	if c, ok := d.cache[name]; ok && c.size == info.Size() && c.mod.Equal(info.ModTime()) {
		d.mu.Unlock()
		return c.sum, nil
	}
	d.mu.Unlock()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return [32]byte{}, err
	}
	var sum [32]byte
	copy(sum[:], h.Sum(nil))

	d.mu.Lock()
	d.cache[name] = digest{size: info.Size(), mod: info.ModTime(), sum: sum}
	d.mu.Unlock()
	return sum, nil
}
