package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// The board side of chunk transfer (wiki Mower-Protocol §12): one request open
// per topic set, a binary chunk or a JSON error as the answer, a new request
// after 10 s without one, five retries in a row.

const (
	headerLen    = 64
	chunkSize    = 4096
	maxRetries   = 5
	maxPathBytes = 1 << 20
	maxFwBytes   = 32 << 20
	defaultTmout = 10 * time.Second
)

type frame struct {
	index, count, size uint32
	ridHash            [8]byte
	sha                [32]byte
	data               []byte
}

// parseFrame checks the fixed fields and the length (§12.2).
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

// dlError ends a download: kind "failed" (no complete file) or "corrupt" (the
// chunks do not add up to a file with the announced hash).
type dlError struct{ kind, message string }

func (e *dlError) Error() string { return e.kind + ": " + e.message }

// downloader is one download over one topic set. It is a state machine the
// board drives with inbound messages and tick, so it needs no goroutines.
type downloader struct {
	publish func(payload []byte) // on <board>/<set>/req
	timeout time.Duration
	prefix  string // request id prefix, unique per boot

	active  bool
	paused  bool
	file    string
	next    uint32
	rid     string
	sentAt  time.Time
	retries int
	seq     int
	first   *frame
	buf     []byte

	// progress gets 0..100; done gets the file and the hash the chunks carried,
	// or the error. Called once per download.
	progress func(pct int)
	done     func(data []byte, sha [32]byte, err *dlError)
}

func newDownloader(publish func([]byte)) *downloader {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return &downloader{publish: publish, timeout: defaultTmout, prefix: hex.EncodeToString(b)}
}

func (d *downloader) start(now time.Time, file string, progress func(int), done func([]byte, [32]byte, *dlError)) {
	*d = downloader{publish: d.publish, timeout: d.timeout, prefix: d.prefix, seq: d.seq, active: true,
		file: file, progress: progress, done: done}
	d.request(now)
}

func (d *downloader) request(now time.Time) {
	d.seq++
	d.rid = fmt.Sprintf("%s-%d", d.prefix, d.seq)
	d.sentAt = now
	req, _ := json.Marshal(map[string]any{"request_id": d.rid, "file": d.file, "chunk": d.next})
	d.publish(req)
}

func (d *downloader) cancel() { d.active, d.rid = false, "" }

// pause stops asking for chunks; resume asks for the chunk again.
func (d *downloader) setPaused(p bool, now time.Time) {
	if !d.active || d.paused == p {
		return
	}
	d.paused = p
	if !p && d.rid == "" {
		d.retries = 0
		d.request(now)
	}
}

func (d *downloader) fail(kind, msg string) {
	d.active = false
	if d.done != nil {
		d.done(nil, [32]byte{}, &dlError{kind, msg})
	}
}

// tick resends a request that got no answer within the timeout.
func (d *downloader) tick(now time.Time) {
	if !d.active || d.paused || d.rid == "" || now.Sub(d.sentAt) < d.timeout {
		return
	}
	if d.retries >= maxRetries {
		d.fail("failed", "no answer to the chunk request")
		return
	}
	d.retries++
	d.request(now)
}

// onRes handles an answer on <set>/res: only an error, which ends the download.
func (d *downloader) onRes(payload []byte) {
	var res struct {
		RequestID string `json:"request_id"`
		Error     struct{ Code, Message string }
	}
	if !d.active || d.rid == "" || json.Unmarshal(payload, &res) != nil || res.RequestID != d.rid {
		return
	}
	d.fail("failed", res.Error.Code+": "+res.Error.Message)
}

// onChunk handles a binary chunk. A frame that does not fit the open request
// is dropped, as the contract says; the timeout then asks again.
func (d *downloader) onChunk(payload []byte, now time.Time) {
	if !d.active || d.rid == "" {
		return
	}
	f, err := parseFrame(payload)
	if err != nil || f.ridHash != ridHash(d.rid) || f.index != d.next || f.count == 0 {
		return
	}
	last := f.index == f.count-1
	if (!last && len(f.data) != chunkSize) || (last && len(f.data) > chunkSize) {
		return
	}
	if d.first == nil {
		first := f
		d.first = &first
	} else if f.count != d.first.count || f.size != d.first.size || f.sha != d.first.sha {
		d.fail("failed", "the file changed during the download")
		return
	}
	d.buf = append(d.buf, f.data...)
	d.rid, d.retries = "", 0
	d.next++
	if d.progress != nil {
		d.progress(int(d.next * 100 / f.count))
	}
	if last {
		d.active = false
		if uint32(len(d.buf)) != f.size {
			d.done(nil, f.sha, &dlError{"corrupt", "the chunks do not add up to the file size"})
			return
		}
		if sha256.Sum256(d.buf) != f.sha {
			d.done(nil, f.sha, &dlError{"corrupt", "the file's SHA-256 does not match the chunks' header"})
			return
		}
		d.done(d.buf, f.sha, nil)
		return
	}
	if !d.paused {
		d.request(now)
	}
}

// appVersion reads the version from an ESP-IDF app image (esp_app_desc_t at
// 0x20, version at 0x30). Other files, such as a test file, have none; the
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
