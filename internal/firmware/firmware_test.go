package firmware

import (
	"bytes"
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidFileName(t *testing.T) {
	for _, name := range []string{"app.bin", "1.2.3.bin", "a_b-c.d.bin", "..bin"} {
		if !ValidFileName(name) {
			t.Errorf("rejected %q", name)
		}
	}
	for _, name := range []string{
		"", "app", "app.BIN", "app.bin ", "app.bin\n", "../app.bin", `..\app.bin`,
		"/app.bin", "dir/app.bin", "app bin.bin", "app+.bin", strings.Repeat("a", 125) + ".bin",
	} {
		if ValidFileName(name) {
			t.Errorf("accepted %q", name)
		}
	}
	if !ValidFileName(strings.Repeat("a", 124) + ".bin") {
		t.Error("128-character name rejected")
	}
}

func TestParseRequest(t *testing.T) {
	req, msg := ParseRequest([]byte(`{"request_id":"r1","file":"app.bin","chunk":2}`))
	if msg != "" || req.Op != "chunk" || req.Chunk != 2 || req.File != "app.bin" || req.RequestID != "r1" {
		t.Fatalf("%+v %q", req, msg)
	}
	req, msg = ParseRequest([]byte(`{"request_id":"r1","op":"info","file":"app.bin","chunk":9}`))
	if msg != "" || req.Op != "info" {
		t.Fatalf("info: %+v %q", req, msg)
	}
	req, msg = ParseRequest([]byte(`{"request_id":"r1","op":"chunk","file":"a.bin","chunk":0}`))
	if msg != "" || req.Chunk != 0 {
		t.Fatalf("%+v %q", req, msg)
	}
	for _, bad := range []string{
		`not json`,
		`{"request_id":"r1","file":"app.bin","chunk":0} trailing`,
		`{"request_id":"","file":"app.bin","chunk":0}`,
		`{"request_id":"has space","file":"app.bin","chunk":0}`,
		`{"request_id":"r1","op":"fetch","file":"app.bin","chunk":0}`,
		`{"request_id":"r1","file":"../a.bin","chunk":0}`,
		`{"request_id":"r1","file":"app.bin"}`,
		`{"request_id":"r1","file":"app.bin","chunk":-1}`,
		`{"request_id":"r1","file":"app.bin","chunk":1.5}`,
		`{"request_id":"r1","file":"app.bin","chunk":"0"}`,
		`{"request_id":"r1","op":"info","file":"nope"}`,
		`null`,
	} {
		if _, msg := ParseRequest([]byte(bad)); msg == "" {
			t.Errorf("accepted %s", bad)
		}
	}
	if _, msg := ParseRequest(bytes.Repeat([]byte(" "), MaxRequestBytes+1)); msg == "" {
		t.Error("oversized request accepted")
	}
}

func TestFrameRoundTrip(t *testing.T) {
	sum := sha256.Sum256([]byte("image"))
	frame, err := EncodeFrame(Frame{
		ChunkIndex: 1, ChunkCount: 3, ImageSize: 9000,
		RequestID: "req-1", SHA256: sum, Payload: []byte("abc"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(frame) != HeaderSize+3 {
		t.Fatalf("len %d", len(frame))
	}
	got, err := ParseFrame(frame)
	if err != nil {
		t.Fatal(err)
	}
	if got.ChunkIndex != 1 || got.ChunkCount != 3 || got.ImageSize != 9000 || string(got.Payload) != "abc" || got.SHA256 != sum {
		t.Fatalf("%+v", got)
	}
	wantHash := RequestIDHash("req-1")
	if !bytes.Equal(frame[24:32], wantHash[:]) {
		t.Fatal("request id hash")
	}
	frame[4] = 2
	if _, err := ParseFrame(frame); err == nil {
		t.Fatal("bad version accepted")
	}
}

func TestChunkingResumeAndLastPartial(t *testing.T) {
	dir := t.TempDir()
	// 10_000 bytes, 4096-byte chunks: 4096 + 4096 + 1808.
	body := bytes.Repeat([]byte{0x5a}, 10000)
	if err := os.WriteFile(filepath.Join(dir, "mower.bin"), body, 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := Open(dir, DefaultChunkBytes)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if n := ChunkCount(int64(len(body)), DefaultChunkBytes); n != 3 {
		t.Fatalf("chunks %d", n)
	}
	var assembled []byte
	var first Meta
	// Resume from the middle, then the tail, then the start.
	for _, index := range []uint32{1, 2, 0} {
		meta, chunk, err := store.ReadChunk("mower.bin", index)
		if err != nil {
			t.Fatal(err)
		}
		if index == 1 {
			first = meta
			if len(chunk) != DefaultChunkBytes {
				t.Fatalf("middle chunk %d", len(chunk))
			}
		}
		if meta.Sum != first.Sum || meta.Size != int64(len(body)) || meta.Chunks != 3 {
			t.Fatalf("%+v", meta)
		}
		off := int(index) * DefaultChunkBytes
		if index == 2 && len(chunk) != 10000-2*DefaultChunkBytes {
			t.Fatalf("last chunk %d", len(chunk))
		}
		if end := off + len(chunk); end > len(assembled) {
			assembled = append(assembled, make([]byte, end-len(assembled))...)
		}
		copy(assembled[off:], chunk)

		frame, err := EncodeFrame(Frame{
			ChunkIndex: index, ChunkCount: meta.Chunks, ImageSize: uint32(meta.Size),
			RequestID: "resume", SHA256: meta.Sum, Payload: chunk,
		})
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := ParseFrame(frame)
		if err != nil || parsed.SHA256 != sha256.Sum256(body) {
			t.Fatalf("frame: %v %+v", err, parsed.SHA256)
		}
	}
	if !bytes.Equal(assembled, body) {
		t.Fatal("assembled bytes differ")
	}
	if sha256.Sum256(assembled) != first.Sum {
		t.Fatal("sha256 differs")
	}

	// A second read uses the cached digest and still matches.
	again, err := store.Stat("mower.bin")
	if err != nil || again.Sum != first.Sum {
		t.Fatal(err, again.Sum)
	}

	if _, _, err := store.ReadChunk("mower.bin", 3); err != ErrBadIndex {
		t.Fatalf("index 3: %v", err)
	}
	if _, err := store.Stat("missing.bin"); err != ErrNotFound {
		t.Fatalf("missing: %v", err)
	}
	if _, err := store.Stat("../mower.bin"); err != ErrBadName {
		t.Fatalf("traversal: %v", err)
	}
	if _, _, err := store.ReadChunk(`dir\mower.bin`, 0); err != ErrBadName {
		t.Fatalf("backslash: %v", err)
	}
}

func TestEmptyFileIsOneChunk(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "empty.bin"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := Open(dir, MinChunkBytes)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	meta, chunk, err := store.ReadChunk("empty.bin", 0)
	if err != nil || len(chunk) != 0 || meta.Chunks != 1 || meta.Size != 0 {
		t.Fatalf("%+v %d %v", meta, len(chunk), err)
	}
	empty := sha256.Sum256(nil)
	if meta.Sum != empty {
		t.Fatal("empty sha")
	}
	if _, _, err := store.ReadChunk("empty.bin", 1); err != ErrBadIndex {
		t.Fatal(err)
	}
}

func TestRejectsDirectoryAndEscape(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "nested.bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := Open(dir, DefaultChunkBytes)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.Stat("nested.bin"); err != ErrNotFound {
		t.Fatalf("directory: %v", err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.bin"), []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Stat("../secret.bin"); err != ErrBadName {
		t.Fatalf("escape: %v", err)
	}
	if _, err := Open(filepath.Join(dir, "missing"), DefaultChunkBytes); err == nil {
		t.Fatal("missing directory opened")
	}
	if _, err := Open(dir, 100); err == nil {
		t.Fatal("small chunk size accepted")
	}
}
