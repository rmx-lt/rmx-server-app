package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// Monitor streams (§15) and the chunk client (§12).

type sample struct {
	session string
	index   int
	time    float64
	rate    int
	metrics []any
	samples [][]any
}

func (r *rig) samples(board string) []sample {
	var out []sample
	for _, m := range r.takeJSON(board + "/monitor") {
		s := sample{session: m["session"].(string), index: int(m["index"].(float64)), time: m["time"].(float64), rate: int(m["rate"].(float64)), metrics: m["metrics"].([]any)}
		for _, row := range m["samples"].([]any) {
			s.samples = append(s.samples, row.([]any))
		}
		out = append(out, s)
	}
	return out
}

func monCmd(session string, metrics string, rate int, extra ...string) []string {
	p := []string{fmt.Sprintf(`"session":%q,"metrics":%s,"rate":%d`, session, metrics, rate)}
	return append(p, extra...)
}

func TestMonitorStream(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m1", "monitor_start", monCmd("m-3", `["battery.v","battery.a"]`, 100)...)
	a := r.wantAck("autopilot", "m1", "done", "")
	res := a["result"].(map[string]any)
	if res["budget"].(float64) != 400 || res["used"].(float64) != 200 {
		t.Fatalf("result %v", res)
	}
	r.takeJSON("autopilot/monitor")
	r.advance(2 * time.Second)
	got := r.samples("autopilot")
	if len(got) < 9 || len(got) > 11 {
		t.Fatalf("%d messages in 2 s, want one per 0.2 s", len(got))
	}
	next := 0
	for _, s := range got {
		if s.session != "m-3" || s.rate != 100 || len(s.metrics) != 2 || s.metrics[0] != "battery.v" || s.index != next {
			t.Fatalf("message %+v, want index %d", s, next)
		}
		for _, row := range s.samples {
			if len(row) != 2 {
				t.Fatalf("a sample has %d values", len(row))
			}
		}
		if len(s.samples) < 15 || len(s.samples) > 25 {
			t.Fatalf("%d samples in 0.2 s at 100/s", len(s.samples))
		}
		next += len(s.samples)
	}
	for i := 1; i < len(got); i++ {
		dt := got[i].time - got[i-1].time
		approx(t, "time between messages", dt, float64(len(got[i-1].samples))/100, 0.001)
	}
	// Whole stream is QoS 0.
	for _, m := range r.msgs("autopilot/monitor") {
		if m.qos != 0 || m.retain {
			t.Fatal("monitor must be QoS 0")
		}
	}
}

func TestMonitorKeepAliveAndHold(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "m1", "monitor_start", monCmd("s", `["battery.v"]`, 10, `"hold":4`)...)
	r.takeJSON("autopilot/monitor")
	r.advance(3 * time.Second)
	// Extended with the same session and a new command id: the index goes on.
	r.cmd("autopilot", "m2", "monitor_start", monCmd("s", `["battery.v"]`, 10, `"hold":4`)...)
	r.wantAck("autopilot", "m2", "done", "")
	if used := r.ack("autopilot", "m2")["result"].(map[string]any)["used"].(float64); used != 10 {
		t.Fatalf("used %v: an extension must not count twice", used)
	}
	r.advance(3 * time.Second) // 6 s since the first start, 3 s since the extension
	got := r.samples("autopilot")
	total := 0
	for _, s := range got {
		if s.index != total {
			t.Fatalf("index %d after %d samples: the extension restarted the stream", s.index, total)
		}
		total += len(s.samples)
	}
	if total < 55 || total > 65 {
		t.Fatalf("%d samples in 6 s at 10/s", total)
	}
	// It ends by itself 4 s after the last monitor_start.
	r.advance(2 * time.Second)
	r.takeJSON("autopilot/monitor")
	r.advance(2 * time.Second)
	if len(r.takeJSON("autopilot/monitor")) != 0 {
		t.Fatal("the stream did not end after its hold")
	}
	// The session id may be used again; the index starts from 0.
	r.cmd("autopilot", "m3", "monitor_start", monCmd("s", `["battery.v"]`, 10)...)
	r.advance(500 * time.Millisecond)
	got = r.samples("autopilot")
	if len(got) == 0 || got[0].index != 0 {
		t.Fatalf("restarted stream: %+v", got)
	}
	// Default hold is 10 s.
	r.advance(10 * time.Second)
	r.takeJSON("autopilot/monitor")
	r.advance(2 * time.Second)
	if len(r.takeJSON("autopilot/monitor")) != 0 {
		t.Fatal("the stream outlived the default hold of 10 s")
	}
}

func TestMonitorErrorsAndBudget(t *testing.T) {
	r := newRig(t).online()
	for id, params := range map[string][]string{
		"e1": monCmd("s", `["no.such"]`, 10),
		"e2": monCmd("s", `["battery.pct"]`, 10),               // offers no rates
		"e3": monCmd("s", `["battery.v"]`, 7),                  // rate not offered
		"e4": monCmd("s", `["battery.v","position.lat"]`, 100), // position.lat offers 10 only
		"e5": monCmd("s", `[]`, 10),
		"e6": monCmd("s", `["battery.*"]`, 10),
		"e7": monCmd("bad session", `["battery.v"]`, 10),
		"e8": monCmd("s", `["battery.v"]`, 10, `"hold":61`),
		"e9": {`"session":"s","rate":10`},
	} {
		r.cmd("autopilot", id, "monitor_start", params...)
		a := r.wantAck("autopilot", id, "failed", "bad_request")
		if a["result"] == nil || a["result"].(map[string]any)["budget"].(float64) != 400 {
			t.Fatalf("%s: a failure must carry the budget: %v", id, a)
		}
	}
	// Fills the budget: 4 metrics x 100.
	r.cmd("autopilot", "b1", "monitor_start", monCmd("a", `["battery.v","battery.a","battery.power","blade.rpm"]`, 100)...)
	if res := r.wantAck("autopilot", "b1", "done", "")["result"].(map[string]any); res["used"].(float64) != 400 {
		t.Fatalf("%v", res)
	}
	r.cmd("autopilot", "b2", "monitor_start", monCmd("b", `["drive.left.rpm"]`, 10)...)
	a := r.wantAck("autopilot", "b2", "failed", "over_budget")
	if a["result"].(map[string]any)["used"].(float64) != 400 || a["result"].(map[string]any)["budget"].(float64) != 400 {
		t.Fatalf("%v", a)
	}
	// A running session id with other metrics or rate: bad_request.
	r.cmd("autopilot", "b3", "monitor_start", monCmd("a", `["battery.v"]`, 100)...)
	r.wantAck("autopilot", "b3", "failed", "bad_request")
	// Streams side by side, each with its own session; stopping one frees budget.
	r.cmd("autopilot", "s1", "monitor_stop", `"session":"a"`)
	r.wantAck("autopilot", "s1", "done", "")
	r.cmd("autopilot", "b4", "monitor_start", monCmd("b", `["drive.left.rpm","drive.right.rpm"]`, 100)...)
	r.cmd("autopilot", "b5", "monitor_start", monCmd("c", `["battery.v"]`, 50)...)
	r.wantAck("autopilot", "b5", "done", "")
	if r.m.ap.mon.used() != 250 {
		t.Fatalf("used %d", r.m.ap.mon.used())
	}
	r.takeJSON("autopilot/monitor")
	r.advance(time.Second)
	sessions := map[string]bool{}
	for _, s := range r.samples("autopilot") {
		sessions[s.session] = true
	}
	if !sessions["b"] || !sessions["c"] || sessions["a"] {
		t.Fatalf("sessions %v", sessions)
	}
	// monitor_stop of a session that is not running is done; without a session every stream stops.
	r.cmd("autopilot", "s2", "monitor_stop", `"session":"zz"`)
	r.wantAck("autopilot", "s2", "done", "")
	r.cmd("autopilot", "s3", "monitor_stop")
	r.wantAck("autopilot", "s3", "done", "")
	if r.m.ap.mon.used() != 0 {
		t.Fatal("streams still running")
	}
}

func TestMonitorEndsWhenTheServerLinkIsLost(t *testing.T) {
	r := newRig(t).online()
	r.cmd("autopilot", "a", "monitor_start", monCmd("s", `["battery.v"]`, 10, `"hold":60`)...)
	r.cmd("gateway", "g", "monitor_start", monCmd("s", `["system.cpu"]`, 1, `"hold":60`)...)
	r.wantAck("gateway", "g", "done", "")
	r.advance(2 * time.Second)
	r.serverStatus("offline")
	r.advance(9 * time.Second)
	if r.m.ap.mon.used() == 0 || r.m.gw.mon.used() == 0 {
		t.Fatal("streams ended before the link was lost (10 s)")
	}
	r.advance(2 * time.Second)
	if r.m.ap.mon.used() != 0 || r.m.gw.mon.used() != 0 {
		t.Fatal("streams survived a lost server link")
	}
}

func TestGatewayMonitor(t *testing.T) {
	r := newRig(t).online()
	// The budget is 100 on the gateway.
	r.cmd("gateway", "a", "monitor_start", monCmd("s", `["usage.total.up","usage.total.down","usage.ntrip.up","usage.ntrip.down","system.cpu","system.core0","system.core1","system.memory.free","system.memory.pct","usage.total.up"]`, 10)...)
	r.wantAck("gateway", "a", "done", "")
	r.cmd("gateway", "b", "monitor_start", monCmd("t", `["system.cpu"]`, 1)...)
	a := r.wantAck("gateway", "b", "failed", "over_budget")
	if a["result"].(map[string]any)["budget"].(float64) != 100 {
		t.Fatalf("%v", a)
	}
	// Rates the gateway offers: 1, 2, 5, 10.
	r.cmd("gateway", "c", "monitor_start", monCmd("u", `["usage.total.up"]`, 20)...)
	r.wantAck("gateway", "c", "failed", "bad_request")
	r.cmd("gateway", "d", "monitor_start", monCmd("u", `["signal.rssi"]`, 1)...)
	r.wantAck("gateway", "d", "failed", "bad_request") // no fast rates
	// A family member is named in full, and exists once it has data.
	r.cmd("gateway", "e", "monitor_stop")
	r.cmd("gateway", "f", "monitor_start", monCmd("v", `["usage.total.up","usage.mqtt.up.autopilot/telemetry"]`, 5)...)
	r.wantAck("gateway", "f", "done", "")
	r.cmd("gateway", "g", "monitor_start", monCmd("w", `["usage.mqtt.up.*"]`, 5)...)
	r.wantAck("gateway", "g", "failed", "bad_request")
	r.cmd("gateway", "h", "monitor_start", monCmd("x", `["usage.mqtt.up.autopilot/job/chunk"]`, 5)...)
	r.wantAck("gateway", "h", "failed", "bad_request")
	// Counters are sent as the running count and grow.
	r.takeJSON("gateway/monitor")
	r.advance(3 * time.Second)
	var vals []float64
	for _, s := range r.samples("gateway") {
		for _, row := range s.samples {
			vals = append(vals, row[0].(float64))
		}
	}
	if len(vals) < 10 {
		t.Fatalf("%d samples", len(vals))
	}
	for i := 1; i < len(vals); i++ {
		if vals[i] < vals[i-1] {
			t.Fatal("a counter went down")
		}
	}
	if vals[len(vals)-1] <= vals[0] {
		t.Fatal("the counter did not grow; a monitor stream is itself traffic")
	}
}

// ---- chunk transfer, the board side -----------------------------------------------------------

func newTestDownloader(timeout time.Duration) (*downloader, *[]string) {
	var reqs []string
	d := newDownloader(func(p []byte) { reqs = append(reqs, string(p)) })
	d.timeout = timeout
	return d, &reqs
}

func TestDownloaderRejectsBadFrames(t *testing.T) {
	file := bytes.Repeat([]byte("abcdefgh"), 1200) // 9600 bytes, 3 chunks
	d, reqs := newTestDownloader(10 * time.Second)
	var got []byte
	var gotErr *dlError
	done := false
	now := epoch
	d.start(now, "x.bin", nil, func(b []byte, _ [32]byte, err *dlError) { got, gotErr, done = b, err, true })
	if len(*reqs) != 1 {
		t.Fatal("no request")
	}
	req := *reqs
	rid := d.rid
	frames := buildFrames(rid, file)

	mutate := map[string]func([]byte){
		"magic":          func(b []byte) { b[0] = 'X' },
		"header version": func(b []byte) { b[4] = 2 },
		"flags":          func(b []byte) { b[5] = 0 },
		"header length":  func(b []byte) { binary.LittleEndian.PutUint16(b[6:], 65) },
		"reserved":       func(b []byte) { b[22] = 1 },
		"chunk length":   func(b []byte) { b[20]-- },
		"request hash":   func(b []byte) { b[24] ^= 1 },
		"chunk number":   func(b []byte) { b[8] = 1 },
		"short chunk":    func(b []byte) { binary.LittleEndian.PutUint16(b[20:], 100) },
	}
	for name, f := range mutate {
		b := append([]byte(nil), frames[0]...)
		f(b)
		if name == "short chunk" {
			b = b[:headerLen+100]
		}
		d.onChunk(b, now)
		if d.next != 0 || len(*reqs) != len(req) || done {
			t.Fatalf("%s: a bad frame was taken", name)
		}
	}
	d.onChunk(frames[0], now)
	if d.next != 1 || len(*reqs) != 2 {
		t.Fatal("a good frame was not taken")
	}
	// An answer to an old request is dropped.
	d.onChunk(frames[1], now)
	if d.next != 1 {
		t.Fatal("the answer to the wrong request was taken")
	}
	f1 := buildFrames(d.rid, file)
	d.onChunk(f1[1], now)
	f2 := buildFrames(d.rid, file)
	d.onChunk(f2[2], now)
	if !done || gotErr != nil || !bytes.Equal(got, file) {
		t.Fatalf("download: done=%v err=%v %d bytes", done, gotErr, len(got))
	}
}

func TestDownloaderChunkHeaderChangeAndCorruption(t *testing.T) {
	file := bytes.Repeat([]byte("z"), 9000)
	run := func(corrupt func(i int, f []byte)) (*dlError, []byte) {
		d, _ := newTestDownloader(time.Second)
		var out []byte
		var derr *dlError
		d.start(epoch, "x.bin", nil, func(b []byte, _ [32]byte, err *dlError) { out, derr = b, err })
		for i := 0; d.active && i < 10; i++ {
			f := buildFrames(d.rid, file)[d.next]
			if corrupt != nil {
				corrupt(int(d.next), f)
			}
			d.onChunk(f, epoch)
		}
		return derr, out
	}
	if err, out := run(nil); err != nil || !bytes.Equal(out, file) {
		t.Fatalf("clean: %v", err)
	}
	// A payload byte flipped: the whole-file SHA-256 fails.
	if err, _ := run(func(i int, f []byte) {
		if i == 1 {
			f[headerLen] ^= 0xff
		}
	}); err == nil || err.kind != "corrupt" {
		t.Fatalf("flipped byte: %v", err)
	}
	// The file changed under us: the chunks' size differs.
	if err, _ := run(func(i int, f []byte) {
		if i == 2 {
			binary.LittleEndian.PutUint32(f[16:], 9001)
		}
	}); err == nil || err.kind != "failed" {
		t.Fatalf("changed header: %v", err)
	}
	// An empty file is one chunk of length 0.
	d, _ := newTestDownloader(time.Second)
	var got []byte
	done := false
	d.start(epoch, "e.bin", nil, func(b []byte, sum [32]byte, err *dlError) {
		got, done = b, err == nil && sum == sha256.Sum256(nil)
	})
	d.onChunk(buildFrames(d.rid, nil)[0], epoch)
	if !done || len(got) != 0 {
		t.Fatal("empty file")
	}
}

func TestDownloaderTimeoutAndRetry(t *testing.T) {
	d, reqs := newTestDownloader(10 * time.Second)
	var derr *dlError
	d.start(epoch, "x.bin", nil, func(_ []byte, _ [32]byte, err *dlError) { derr = err })
	now := epoch
	for i := 1; i <= 5; i++ {
		now = now.Add(9900 * time.Millisecond)
		d.tick(now)
		if len(*reqs) != i {
			t.Fatalf("a request was repeated before 10 s")
		}
		now = now.Add(100 * time.Millisecond)
		d.tick(now)
		if len(*reqs) != i+1 {
			t.Fatalf("retry %d not sent after 10 s", i)
		}
	}
	// Six requests: the first and five retries. The sixth wait ends the download.
	if derr != nil {
		t.Fatal("failed too early")
	}
	d.tick(now.Add(10 * time.Second))
	if derr == nil || derr.kind != "failed" || len(*reqs) != 6 {
		t.Fatalf("after five retries: err=%v requests=%d", derr, len(*reqs))
	}
}

func TestDownloaderErrorAnswer(t *testing.T) {
	d, _ := newTestDownloader(time.Second)
	var derr *dlError
	d.start(epoch, "x.bin", nil, func(_ []byte, _ [32]byte, err *dlError) { derr = err })
	// An error for another request is not ours.
	d.onRes([]byte(`{"request_id":"other","error":{"code":"not_found","message":"no such file"}}`))
	if derr != nil {
		t.Fatal("an error for another request ended the download")
	}
	d.onRes([]byte(`{"request_id":"` + d.rid + `","error":{"code":"not_found","message":"no such file"}}`))
	if derr == nil || derr.kind != "failed" {
		t.Fatalf("%v", derr)
	}
}

func TestDownloaderRequestFormat(t *testing.T) {
	d, reqs := newTestDownloader(time.Second)
	d.start(epoch, "j-1.json", nil, func([]byte, [32]byte, *dlError) {})
	var req struct {
		RequestID string `json:"request_id"`
		File      string
		Chunk     int
	}
	if err := json.Unmarshal([]byte((*reqs)[0]), &req); err != nil || req.File != "j-1.json" || req.Chunk != 0 || !validID(req.RequestID) {
		t.Fatalf("%s %v", (*reqs)[0], err)
	}
	// 4096-byte chunks: a 4096-byte file is one chunk, 4097 bytes two.
	for size, chunks := range map[int]int{0: 1, 1: 1, 4096: 1, 4097: 2, 8192: 2, 8193: 3} {
		if got := len(buildFrames("r", make([]byte, size))); got != chunks {
			t.Fatalf("%d bytes: %d chunks", size, got)
		}
	}
}
