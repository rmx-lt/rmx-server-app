package transfer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/core"
)

func TestValidFileName(t *testing.T) {
	for _, name := range []string{"app.bin", "1.2.3.bin", "a_b-c.d.bin", "j-2031.json", "a", strings.Repeat("a", 128)} {
		if !ValidFileName(name) {
			t.Errorf("rejected %q", name)
		}
	}
	for _, name := range []string{
		"", ".", "..", "../app.bin", `..\app.bin`, "/app.bin", "dir/app.bin",
		"app bin.bin", "app+.bin", "app.bin\n", strings.Repeat("a", 129),
	} {
		if ValidFileName(name) {
			t.Errorf("accepted %q", name)
		}
	}
}

func TestParseRequest(t *testing.T) {
	req, msg := ParseRequest([]byte(`{"request_id":"r1","file":"app.bin","chunk":2,"extra":true}`))
	if msg != "" || req.Chunk != 2 || req.File != "app.bin" || req.RequestID != "r1" {
		t.Fatalf("%+v %q", req, msg)
	}
	req, msg = ParseRequest([]byte(`{"request_id":"r1","file":"a.json","chunk":0}`))
	if msg != "" || req.Chunk != 0 {
		t.Fatalf("%+v %q", req, msg)
	}
	// An unusable request: the message says why, and the id is echoed only when it was valid.
	for body, wantID := range map[string]string{
		`not json`: "",
		`{"request_id":"r1","file":"app.bin","chunk":0} trailing`: "",
		`{"request_id":"","file":"app.bin","chunk":0}`:            "",
		`{"request_id":"has space","file":"app.bin","chunk":0}`:   "",
		`{"request_id":7,"file":"app.bin","chunk":0}`:             "",
		`{"request_id":"r1","file":"../a.bin","chunk":0}`:         "r1",
		`{"request_id":"r1","file":"app.bin"}`:                    "r1",
		`{"request_id":"r1","file":"app.bin","chunk":-1}`:         "r1",
		`{"request_id":"r1","file":"app.bin","chunk":1.5}`:        "r1",
		`{"request_id":"r1","file":"app.bin","chunk":"0"}`:        "r1",
		`{"request_id":"r1","file":7,"chunk":0}`:                  "r1",
		`null`:                                                    "",
	} {
		got, msg := ParseRequest([]byte(body))
		if msg == "" {
			t.Errorf("accepted %s", body)
		} else if got.RequestID != wantID {
			t.Errorf("%s: id %q, want %q", body, got.RequestID, wantID)
		}
	}
	if _, msg := ParseRequest(bytes.Repeat([]byte(" "), MaxRequestBytes+1)); msg == "" {
		t.Error("oversized request accepted")
	}
}

// The header is the one of wiki Mower-Protocol §12.2, byte for byte.
func TestFrameLayout(t *testing.T) {
	sum := sha256.Sum256([]byte("image"))
	frame, err := EncodeFrame(Frame{
		ChunkIndex: 1, ChunkCount: 3, FileSize: 9000,
		RequestID: "req-1", SHA256: sum, Payload: []byte("abc"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(frame) != 64+3 {
		t.Fatalf("len %d", len(frame))
	}
	if !bytes.Equal(frame[0:4], []byte{0x52, 0x4D, 0x46, 0x57}) {
		t.Fatalf("magic %x", frame[0:4])
	}
	if frame[4] != 1 || frame[5] != 1 {
		t.Fatalf("version %d flags %d", frame[4], frame[5])
	}
	le := binary.LittleEndian
	for _, c := range []struct {
		name      string
		got, want uint64
	}{
		{"header length", uint64(le.Uint16(frame[6:8])), 64},
		{"chunk number", uint64(le.Uint32(frame[8:12])), 1},
		{"chunk count", uint64(le.Uint32(frame[12:16])), 3},
		{"file size", uint64(le.Uint32(frame[16:20])), 9000},
		{"chunk length", uint64(le.Uint16(frame[20:22])), 3},
		{"reserved", uint64(le.Uint16(frame[22:24])), 0},
	} {
		if c.got != c.want {
			t.Errorf("%s = %d, want %d", c.name, c.got, c.want)
		}
	}
	id := sha256.Sum256([]byte("req-1"))
	if !bytes.Equal(frame[24:32], id[:8]) {
		t.Error("request id hash is not the first 8 bytes of SHA-256 over the request id")
	}
	if !bytes.Equal(frame[32:64], sum[:]) {
		t.Error("file hash")
	}
	if string(frame[64:]) != "abc" {
		t.Error("chunk bytes")
	}

	got, err := ParseFrame(frame)
	if err != nil || got.ChunkIndex != 1 || got.ChunkCount != 3 || got.FileSize != 9000 || got.SHA256 != sum || string(got.Payload) != "abc" {
		t.Fatalf("%v %+v", err, got)
	}
	for name, mutate := range map[string]func([]byte){
		"magic":    func(b []byte) { b[0] = 'X' },
		"version":  func(b []byte) { b[4] = 2 },
		"flags":    func(b []byte) { b[5] = 0 },
		"header":   func(b []byte) { b[6] = 65 },
		"length":   func(b []byte) { b[20] = 4 },
		"reserved": func(b []byte) { b[22] = 1 },
	} {
		bad := bytes.Clone(frame)
		mutate(bad)
		if _, err := ParseFrame(bad); err == nil {
			t.Errorf("a frame with a wrong %s was accepted", name)
		}
	}
}

func TestChunkingResumeAndLastPartial(t *testing.T) {
	dir := t.TempDir()
	// 10_000 bytes, 4096-byte chunks: 4096 + 4096 + 1808.
	body := bytes.Repeat([]byte{0x5a}, 10000)
	if err := os.WriteFile(filepath.Join(dir, "mower.bin"), body, 0o644); err != nil {
		t.Fatal(err)
	}
	d, err := OpenDir(dir, MaxFirmwareBytes)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })

	if n := ChunkCount(int64(len(body))); n != 3 {
		t.Fatalf("chunks %d", n)
	}
	var assembled []byte
	var first Meta
	// Resume from the middle, then the tail, then the start.
	for _, index := range []uint32{1, 2, 0} {
		meta, chunk, err := d.ReadChunk("mower.bin", index)
		if err != nil {
			t.Fatal(err)
		}
		if index == 1 {
			first = meta
			if len(chunk) != ChunkBytes {
				t.Fatalf("middle chunk %d", len(chunk))
			}
		}
		if meta.Sum != first.Sum || meta.Size != int64(len(body)) || meta.Chunks != 3 {
			t.Fatalf("%+v", meta)
		}
		if index == 2 && len(chunk) != 10000-2*ChunkBytes {
			t.Fatalf("last chunk %d", len(chunk))
		}
		off := int(index) * ChunkBytes
		if end := off + len(chunk); end > len(assembled) {
			assembled = append(assembled, make([]byte, end-len(assembled))...)
		}
		copy(assembled[off:], chunk)
	}
	if !bytes.Equal(assembled, body) || sha256.Sum256(assembled) != first.Sum {
		t.Fatal("assembled file differs")
	}

	if _, _, err := d.ReadChunk("mower.bin", 3); err != ErrBadIndex {
		t.Fatalf("chunk 3: %v", err)
	}
	if _, err := d.Stat("missing.bin"); err != ErrNotFound {
		t.Fatalf("missing: %v", err)
	}
	if _, err := d.Stat("../mower.bin"); err != ErrBadName {
		t.Fatalf("traversal: %v", err)
	}
	if _, _, err := d.ReadChunk(`dir\mower.bin`, 0); err != ErrBadName {
		t.Fatalf("backslash: %v", err)
	}
}

func TestEmptyFileIsOneChunk(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "empty.bin"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	d, err := OpenDir(dir, MaxFirmwareBytes)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	meta, chunk, err := d.ReadChunk("empty.bin", 0)
	if err != nil || len(chunk) != 0 || meta.Chunks != 1 || meta.Size != 0 || meta.Sum != sha256.Sum256(nil) {
		t.Fatalf("%+v %d %v", meta, len(chunk), err)
	}
	if _, _, err := d.ReadChunk("empty.bin", 1); err != ErrBadIndex {
		t.Fatal(err)
	}
}

func TestSizeLimitAndNonFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "nested.bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "big.json"), make([]byte, 101), 0o644); err != nil {
		t.Fatal(err)
	}
	d, err := OpenDir(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if _, err := d.Stat("nested.bin"); err != ErrNotFound {
		t.Fatalf("directory: %v", err)
	}
	if _, err := d.Stat("big.json"); err != ErrTooLarge {
		t.Fatalf("over the limit: %v", err)
	}
	if _, err := OpenDir(filepath.Join(dir, "missing"), 100); err == nil {
		t.Fatal("missing directory opened")
	}
}

// ---- The handler ---------------------------------------------------------------

type sent struct {
	device  core.DeviceID
	suffix  string
	payload []byte
}

// fakePub records publishes; a publish blocks while hold is not nil.
type fakePub struct {
	mu   sync.Mutex
	out  []sent
	hold chan struct{}
	seen chan struct{}
}

func (p *fakePub) Publish(_ context.Context, device core.DeviceID, suffix string, payload []byte) error {
	if p.seen != nil {
		p.seen <- struct{}{}
	}
	if p.hold != nil {
		<-p.hold
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.out = append(p.out, sent{device, suffix, payload})
	return nil
}

func (p *fakePub) sent() []sent {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]sent(nil), p.out...)
}

// setup gives each set its own file under the same name, so a request that
// reached the wrong set would show in the bytes.
func setup(t *testing.T, pub *fakePub) (*mqttHandler, map[Set][]byte) {
	t.Helper()
	files := map[Set][]byte{
		GatewayFirmware:   bytes.Repeat([]byte("g"), 5000),
		AutopilotFirmware: bytes.Repeat([]byte("a"), 9000),
		AutopilotPath:     []byte(`{"path":"j-1"}`),
	}
	dirs := map[Set]*Dir{}
	for set, body := range files {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "x.bin"), body, 0o644); err != nil {
			t.Fatal(err)
		}
		d, err := OpenDir(dir, MaxFirmwareBytes)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = d.Close() })
		dirs[set] = d
	}
	return &mqttHandler{pub: pub, svc: NewService(dirs)}, files
}

func TestHandlerAnswersChunkOnItsOwnSetOnly(t *testing.T) {
	pub := &fakePub{}
	h, files := setup(t, pub)
	for _, set := range Sets {
		h.handle(context.Background(), set, "m1", []byte(`{"request_id":"q","file":"x.bin","chunk":0}`))
	}
	out := pub.sent()
	if len(out) != 3 {
		t.Fatalf("%d answers", len(out))
	}
	for i, set := range Sets {
		if out[i].suffix != string(set)+"/chunk" || out[i].device != "m1" {
			t.Fatalf("answer %d went to %s %s", i, out[i].device, out[i].suffix)
		}
		f, err := ParseFrame(out[i].payload)
		if err != nil {
			t.Fatal(err)
		}
		body := files[set]
		if f.FileSize != uint32(len(body)) || f.SHA256 != sha256.Sum256(body) || !bytes.Equal(f.Payload, body[:min(len(body), ChunkBytes)]) {
			t.Fatalf("%s: wrong file served", set)
		}
		if f.IDHash != RequestIDHash("q") {
			t.Fatalf("%s: request id hash", set)
		}
	}
}

func TestHandlerErrors(t *testing.T) {
	pub := &fakePub{}
	h, _ := setup(t, pub)
	ask := func(set Set, body string) ErrorMessage {
		t.Helper()
		before := len(pub.sent())
		h.handle(context.Background(), set, "m1", []byte(body))
		out := pub.sent()
		if len(out) != before+1 || out[before].suffix != string(set)+"/res" {
			t.Fatalf("expected one answer on %s/res, got %v", set, out[before:])
		}
		var e ErrorMessage
		if err := json.Unmarshal(out[before].payload, &e); err != nil {
			t.Fatal(err)
		}
		return e
	}
	for _, c := range []struct {
		name, body, code, id string
		set                  Set
	}{
		{"no such file", `{"request_id":"e1","file":"nope.bin","chunk":0}`, "not_found", "e1", GatewayFirmware},
		{"path as name", `{"request_id":"e2","file":"../x.bin","chunk":0}`, "bad_request", "e2", GatewayFirmware},
		{"chunk past the end", `{"request_id":"e3","file":"x.bin","chunk":2}`, "bad_request", "e3", GatewayFirmware},
		{"not json", `hello`, "bad_request", "", AutopilotPath},
		{"bad request id", `{"request_id":"a b","file":"x.bin","chunk":0}`, "bad_request", "", AutopilotPath},
	} {
		e := ask(c.set, c.body)
		if e.Error.Code != c.code || e.RequestID != c.id || e.Error.Message == "" {
			t.Errorf("%s: %+v", c.name, e)
		}
	}
	// A set with no directory has no files.
	h.svc.dirs = map[Set]*Dir{}
	if e := ask(AutopilotPath, `{"request_id":"e4","file":"x.json","chunk":0}`); e.Error.Code != "not_found" {
		t.Errorf("unconfigured set: %+v", e)
	}
}

// One request is open per topic set: a second one on the same set is ignored
// while the first is being answered, and another set is answered side by side.
func TestOneRequestPerTopicSet(t *testing.T) {
	pub := &fakePub{hold: make(chan struct{}), seen: make(chan struct{}, 8)}
	h, _ := setup(t, pub)
	ctx := context.Background()
	body := []byte(`{"request_id":"q","file":"x.bin","chunk":0}`)

	var wg sync.WaitGroup
	run := func(set Set) {
		wg.Add(1)
		go func() { defer wg.Done(); h.handle(ctx, set, "m1", body) }()
	}
	run(AutopilotPath)
	run(AutopilotFirmware) // another set, same device: not blocked
	for range 2 {
		select {
		case <-pub.seen:
		case <-time.After(5 * time.Second):
			t.Fatal("the two sets were not answered side by side")
		}
	}
	// A second request on a busy set is dropped without an answer.
	h.handle(ctx, AutopilotPath, "m1", body)
	select {
	case <-pub.seen:
		t.Fatal("a second request on the same set was answered")
	default:
	}
	// Another device is not blocked either.
	run2 := make(chan struct{})
	go func() { h.handle(ctx, AutopilotPath, "m2", body); close(run2) }()
	select {
	case <-pub.seen:
	case <-time.After(5 * time.Second):
		t.Fatal("another device was blocked")
	}
	close(pub.hold)
	wg.Wait()
	<-run2
	// Once answered, the set takes the next request.
	pub.hold = nil
	before := len(pub.sent())
	h.handle(ctx, AutopilotPath, "m1", body)
	if len(pub.sent()) != before+1 {
		t.Fatal("the set did not take a request after the first was answered")
	}
}

func TestGate(t *testing.T) {
	var g gate
	if !g.acquire("m1", AutopilotPath) || g.acquire("m1", AutopilotPath) {
		t.Fatal("one acquire per device and set")
	}
	if !g.acquire("m1", AutopilotFirmware) || !g.acquire("m2", AutopilotPath) {
		t.Fatal("another set or device was blocked")
	}
	g.release("m1", AutopilotPath)
	if !g.acquire("m1", AutopilotPath) {
		t.Fatal("acquire after release")
	}
	g.release("m9", GatewayFirmware) // a spare release must not panic
}

func TestOpenDirectories(t *testing.T) {
	fw := t.TempDir()
	if err := os.Mkdir(filepath.Join(fw, "gateway"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fw, "gateway", "1.0.0.bin"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	paths := t.TempDir()
	svc, err := Open(Config{FirmwareDir: fw, PathFileDir: paths})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	// The autopilot subdirectory is missing: that set is empty, not an error.
	if _, _, err := svc.ReadChunk(GatewayFirmware, "1.0.0.bin", 0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.ReadChunk(AutopilotFirmware, "1.0.0.bin", 0); err != ErrNotFound {
		t.Fatalf("autopilot set: %v", err)
	}
	// The same name in another set does not leak across.
	if _, _, err := svc.ReadChunk(AutopilotPath, "1.0.0.bin", 0); err != ErrNotFound {
		t.Fatalf("path set: %v", err)
	}
	if _, err := Open(Config{FirmwareDir: filepath.Join(fw, "nope")}); err == nil {
		t.Fatal("a missing FIRMWARE_DIR opened")
	}
	if _, err := Open(Config{PathFileDir: filepath.Join(fw, "nope")}); err == nil {
		t.Fatal("a missing PATH_FILE_DIR opened")
	}
}
