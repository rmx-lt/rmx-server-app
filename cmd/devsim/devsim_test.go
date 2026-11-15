package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

var t0 = time.Unix(1_800_000_000, 0)

func testDevice() *device { return newDevice("mower-sim", "1.0.0", func() time.Time { return t0 }) }

func ask(t *testing.T, d *device, cmd string) (*reply, *otaJob, bool) {
	t.Helper()
	return d.handle([]byte(cmd))
}

func TestCommands(t *testing.T) {
	d := testDevice()
	r, _, _ := ask(t, d, `{"id":"a","cmd":"ping"}`)
	if !r.OK || r.Result.(map[string]string)["pong"] != "mower-sim" {
		t.Fatalf("ping: %+v", r)
	}
	r, _, _ = ask(t, d, `{"id":"b","cmd":"status"}`)
	st := r.Result.(statusResult)
	if !r.OK || st.Version != "1.0.0" || st.Partition != "ota_0" || st.OTA.State != "idle" || !st.PPP {
		t.Fatalf("status: %+v", r)
	}
	r, _, _ = ask(t, d, `{"id":"c","cmd":"gps"}`)
	loc := r.Result.(map[string]any)["location"].(string)
	var fix map[string]any
	if !r.OK || json.Unmarshal([]byte(loc), &fix) != nil || fix["gps"] != "fix" {
		t.Fatalf("gps: %+v", r)
	}
	if r, _, restart := ask(t, d, `{"id":"d","cmd":"restart"}`); !r.OK || !restart {
		t.Fatalf("restart: %+v", r)
	}
	if r, _, _ := ask(t, d, `{"id":"a","cmd":"ping"}`); r != nil {
		t.Fatalf("duplicate id answered: %+v", r)
	}
}

func TestCommandErrors(t *testing.T) {
	d := testDevice()
	for cmd, code := range map[string]string{
		`not json`:       "bad_request",
		`{"cmd":"ping"}`: "bad_request",
		`{"id":"` + strings.Repeat("x", 65) + `","cmd":"ping"}`:       "bad_request",
		`{"id":"e1","cmd":"ping","expires_at":"soon"}`:                "bad_request",
		`{"id":"e2","cmd":"ping","expires_at":1700000000}`:            "expired",
		`{"id":"e3","cmd":"dance"}`:                                   "unknown_cmd",
		`{"id":"e4","cmd":"ota","version":"1.0.0"}`:                   "same_version",
		`{"id":"e5","cmd":"ota"}`:                                     "bad_request",
		`{"id":"e6","cmd":"ota","version":"2.0.0","size":"x"}`:        "bad_request",
		`{"id":"e7","cmd":"ota","version":"2.0.0","file":"../x.bin"}`: "bad_request",
	} {
		r, _, _ := ask(t, d, cmd)
		if r == nil || r.OK || r.Error != code {
			t.Errorf("%s: got %+v, want %s", cmd, r, code)
		}
	}
	if r, _, _ := ask(t, d, `{"id":"e8","cmd":"ping","expires_at":1900000000}`); !r.OK {
		t.Errorf("future expires_at refused: %+v", r)
	}
}

func TestOTAStartAndBusy(t *testing.T) {
	d := testDevice()
	r, job, _ := ask(t, d, `{"id":"o1","cmd":"ota","url":"https://x/fw/2.0.0.bin?x=1","version":"2.0.0","size":10}`)
	if !r.OK || job == nil || job.file != "2.0.0.bin" || job.size != 10 || job.from != "1.0.0" {
		t.Fatalf("start: %+v %+v", r, job)
	}
	if r, _, _ := ask(t, d, `{"id":"o2","cmd":"ota","version":"3.0.0"}`); r.Error != "busy" {
		t.Fatalf("second update: %+v", r)
	}
	if r, _, _ := ask(t, d, `{"id":"o3","cmd":"gps"}`); r.Error != "busy" {
		t.Fatalf("gps during update: %+v", r)
	}
	d.finishOTA(job, "")
	if s := d.status(); s.Version != "2.0.0" || s.Partition != "ota_1" || s.OTA.State != "idle" {
		t.Fatalf("after update: %+v", s)
	}
}

// frames builds the server's chunk frames for image (wiki Server-App,
// "Chunk frame").
func frames(rid string, image []byte, chunk int) [][]byte {
	sum := sha256.Sum256(image)
	h := ridHash(rid)
	count := max((len(image)+chunk-1)/chunk, 1)
	var out [][]byte
	for i := 0; i < count; i++ {
		data := image[i*chunk : min((i+1)*chunk, len(image))]
		b := make([]byte, headerLen+len(data))
		copy(b, "RMFW")
		b[4], b[5] = 1, 1
		binary.LittleEndian.PutUint16(b[6:], headerLen)
		binary.LittleEndian.PutUint32(b[8:], uint32(i))
		binary.LittleEndian.PutUint32(b[12:], uint32(count))
		binary.LittleEndian.PutUint32(b[16:], uint32(len(image)))
		binary.LittleEndian.PutUint16(b[20:], uint16(len(data)))
		copy(b[24:], h[:])
		copy(b[32:], sum[:])
		copy(b[64:], data)
		out = append(out, b)
	}
	return out
}

// fakeServer answers fw/req like rmx-server; corrupt changes the answer.
func fakeServer(c *fwClient, image []byte, corrupt func(i int, f []byte) []byte) {
	c.publish = func(p []byte) error {
		var req struct {
			RequestID string `json:"request_id"`
			File      string
			Chunk     int
		}
		_ = json.Unmarshal(p, &req)
		go func() {
			if req.File != "app.bin" {
				c.deliver([]byte(`{"request_id":"`+req.RequestID+`","error":{"code":"not_found","message":"no such file"}}`), false)
				return
			}
			f := frames(req.RequestID, image, 100)[req.Chunk]
			if corrupt != nil {
				f = corrupt(req.Chunk, f)
			}
			c.deliver(f, true)
		}()
		return nil
	}
}

func TestDownload(t *testing.T) {
	image := bytes.Repeat([]byte("firmware"), 40) // 320 bytes: 4 chunks of 100
	c := &fwClient{timeout: time.Second}
	fakeServer(c, image, nil)
	var last int
	got, err := c.download(context.Background(), "app.bin", int64(len(image)), "2.0.0", func(p int) { last = p })
	if err != nil || !bytes.Equal(got, image) || last != 100 {
		t.Fatalf("download: %v, %d bytes, progress %d", err, len(got), last)
	}

	_, err = c.download(context.Background(), "nope.bin", 0, "2.0.0", func(int) {})
	if fe := (*fwError)(nil); !errors.As(err, &fe) || fe.code != "not_found" {
		t.Fatalf("missing file: %v", err)
	}
	_, err = c.download(context.Background(), "app.bin", 999, "2.0.0", func(int) {})
	if fe := (*fwError)(nil); !errors.As(err, &fe) || fe.code != "bad_size" {
		t.Fatalf("size mismatch: %v", err)
	}

	fakeServer(c, image, func(i int, f []byte) []byte {
		if i == 2 {
			f[headerLen] ^= 0xff // flip a payload byte: the whole-image SHA-256 fails
		}
		return f
	})
	_, err = c.download(context.Background(), "app.bin", 0, "2.0.0", func(int) {})
	if fe := (*fwError)(nil); !errors.As(err, &fe) || fe.code != "bad_image" {
		t.Fatalf("corrupt chunk: %v", err)
	}
}

func TestDownloadTimeout(t *testing.T) {
	c := &fwClient{timeout: 10 * time.Millisecond, publish: func([]byte) error { return nil }}
	_, err := c.download(context.Background(), "app.bin", 0, "2.0.0", func(int) {})
	if fe := (*fwError)(nil); !errors.As(err, &fe) || fe.code != "download_failed" {
		t.Fatalf("no answer: %v", err)
	}
}

func TestParseFrameRejects(t *testing.T) {
	good := frames("r", []byte("abc"), 100)[0]
	if _, err := parseFrame(good); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func([]byte){
		"magic":    func(b []byte) { b[0] = 'X' },
		"version":  func(b []byte) { b[4] = 2 },
		"flags":    func(b []byte) { b[5] = 0 },
		"reserved": func(b []byte) { b[22] = 1 },
		"length":   func(b []byte) { b[20] = 9 },
	} {
		b := append([]byte(nil), good...)
		mutate(b)
		if _, err := parseFrame(b); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestAppVersion(t *testing.T) {
	img := make([]byte, 0x60)
	img[0] = 0xE9
	binary.LittleEndian.PutUint32(img[0x20:], 0xABCD5432)
	copy(img[0x30:], "0.4.0")
	if v, ok := appVersion(img); !ok || v != "0.4.0" {
		t.Fatalf("%q %v", v, ok)
	}
	if _, ok := appVersion([]byte("plain test file, not an app image, long enough to pass the length check.....")); ok {
		t.Fatal("plain file has a version")
	}
}
