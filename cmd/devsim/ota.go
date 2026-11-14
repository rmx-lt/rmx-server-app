package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

// The device side of the firmware download (wiki Server-App, "Firmware over
// MQTT"): requests on fw/req, binary chunks on fw/chunk, info and errors as
// JSON on fw/res. Written from the contract, not from internal/firmware, so it
// checks the server the way the board does.

const headerLen = 64

type frame struct {
	index, count, size uint32
	ridHash            [8]byte
	sha                [32]byte
	data               []byte
}

func parseFrame(b []byte) (frame, error) {
	var f frame
	if len(b) < headerLen {
		return f, errors.New("frame shorter than the header")
	}
	if string(b[0:4]) != "RMFW" || b[4] != 1 || b[5] != 1 ||
		binary.LittleEndian.Uint16(b[6:8]) != headerLen || binary.LittleEndian.Uint16(b[22:24]) != 0 {
		return f, errors.New("bad frame header")
	}
	n := int(binary.LittleEndian.Uint16(b[20:22]))
	if len(b) != headerLen+n {
		return f, fmt.Errorf("frame is %d bytes, header says %d", len(b), headerLen+n)
	}
	f.index = binary.LittleEndian.Uint32(b[8:12])
	f.count = binary.LittleEndian.Uint32(b[12:16])
	f.size = binary.LittleEndian.Uint32(b[16:20])
	copy(f.ridHash[:], b[24:32])
	copy(f.sha[:], b[32:64])
	f.data = b[headerLen:]
	return f, nil
}

func ridHash(rid string) (h [8]byte) {
	sum := sha256.Sum256([]byte(rid))
	copy(h[:], sum[:8])
	return h
}

// fwError is an error answer on fw/res, or a download problem, as the ota
// error code the firmware would send.
type fwError struct{ code, message string }

func (e *fwError) Error() string { return e.code + ": " + e.message }

// fwClient matches answers to the request in flight. One request at a time,
// like the board.
type fwClient struct {
	publish func(payload []byte) error // on mower/<name>/fw/req
	timeout time.Duration

	mu      sync.Mutex
	rid     string
	pending chan []byte // a chunk frame, or a fw/res JSON prefixed with '{'
}

func (c *fwClient) deliver(payload []byte, isChunk bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pending == nil {
		return
	}
	if isChunk {
		f, err := parseFrame(payload)
		if err != nil || f.ridHash != ridHash(c.rid) {
			return
		}
	} else {
		var res struct {
			RequestID string `json:"request_id"`
		}
		if json.Unmarshal(payload, &res) != nil || res.RequestID != c.rid {
			return
		}
	}
	select {
	case c.pending <- payload:
	default:
	}
}

// chunk asks for one chunk and waits for its frame. It retries a lost answer
// three times, like the firmware.
func (c *fwClient) chunk(ctx context.Context, file string, index uint32) (frame, error) {
	for attempt := 0; attempt < 3; attempt++ {
		rid := newRequestID()
		ch := make(chan []byte, 1)
		c.mu.Lock()
		c.rid, c.pending = rid, ch
		c.mu.Unlock()
		req, _ := json.Marshal(map[string]any{"request_id": rid, "file": file, "chunk": index})
		if err := c.publish(req); err != nil {
			return frame{}, &fwError{"download_failed", err.Error()}
		}
		select {
		case <-ctx.Done():
			return frame{}, &fwError{"failed", "stopped"}
		case <-time.After(c.timeout):
			continue
		case msg := <-ch:
			c.mu.Lock()
			c.pending = nil
			c.mu.Unlock()
			if len(msg) > 0 && msg[0] == '{' {
				var res struct {
					Error struct{ Code, Message string } `json:"error"`
				}
				_ = json.Unmarshal(msg, &res)
				code := res.Error.Code
				if code != "bad_request" && code != "not_found" {
					code = "failed"
				}
				return frame{}, &fwError{code, res.Error.Message}
			}
			f, err := parseFrame(msg)
			if err != nil {
				return frame{}, &fwError{"bad_image", err.Error()}
			}
			if f.index != index {
				return frame{}, &fwError{"bad_image", "firmware chunk index does not match the request"}
			}
			return f, nil
		}
	}
	return frame{}, &fwError{"download_failed", "no firmware chunk (the link dropped or firmware is not served)"}
}

// download fetches the whole file and checks it the way the board does.
// progress gets 0..100.
func (c *fwClient) download(ctx context.Context, file string, wantSize int64, wantVersion string, progress func(int)) ([]byte, error) {
	first, err := c.chunk(ctx, file, 0)
	if err != nil {
		return nil, err
	}
	if first.count == 0 {
		return nil, &fwError{"bad_size", "firmware image size is not usable"}
	}
	if wantSize > 0 && int64(first.size) != wantSize {
		return nil, &fwError{"bad_size", "the image size differs from the command"}
	}
	image := make([]byte, 0, first.size)
	image = append(image, first.data...)
	progress(100 / int(first.count))
	for i := uint32(1); i < first.count; i++ {
		f, err := c.chunk(ctx, file, i)
		if err != nil {
			return nil, err
		}
		if f.count != first.count || f.size != first.size || f.sha != first.sha {
			return nil, &fwError{"bad_image", "firmware chunk header changed mid-download"}
		}
		image = append(image, f.data...)
		progress(int((i + 1) * 100 / first.count))
	}
	if uint32(len(image)) != first.size {
		return nil, &fwError{"bad_size", "the chunks do not add up to the image size"}
	}
	if sha256.Sum256(image) != first.sha {
		return nil, &fwError{"bad_image", "image SHA-256 does not match the firmware header"}
	}
	if v, ok := appVersion(image); ok && v != wantVersion {
		return nil, &fwError{"bad_image", "the image has another version than the command"}
	}
	return image, nil
}

// appVersion reads the version from an ESP-IDF app image (esp_app_desc_t at
// 0x20, version at 0x30). Other files, like a test file, have none, and the
// simulator accepts them.
func appVersion(image []byte) (string, bool) {
	if len(image) < 0x50 || image[0] != 0xE9 || binary.LittleEndian.Uint32(image[0x20:0x24]) != 0xABCD5432 {
		return "", false
	}
	v := image[0x30:0x50]
	if i := bytes.IndexByte(v, 0); i >= 0 {
		v = v[:i]
	}
	return string(v), true
}

func newRequestID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "sim-" + hex.EncodeToString(b)
}
