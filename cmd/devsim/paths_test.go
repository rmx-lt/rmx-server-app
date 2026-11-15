package main

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A path (§11): download over chunk transfer, check, follow, path.point, done.

func (r *rig) twoSegmentPath(id string) []byte {
	return pathFile(id, 0.6,
		seg{false, [][2]float64{r.geo(1, 0), r.geo(2, 0)}},
		seg{true, [][2]float64{r.geo(2, 0), r.geo(2, 1.5)}})
}

// bigPath is a file of several chunks whose points all lie at the mower.
func (r *rig) bigPath(id string, points int) []byte {
	var pts [][2]float64
	for i := 0; i < points; i++ {
		pts = append(pts, r.geo(0.01*float64(i%3), 0))
	}
	return pathFile(id, 0.5, seg{false, pts})
}

func TestPathDownloadAndFollow(t *testing.T) {
	r := newRig(t).online()
	r.startPath("j-2031", r.twoSegmentPath("j-2031"))
	r.wantAck("autopilot", "c-j-2031", "accepted", "")
	r.advance(200 * time.Millisecond)
	s := r.apState()
	if s["mode"] != "path" || s["path"] != "j-2031" || s["paused"] != nil {
		t.Fatalf("state: %v", s)
	}
	if r.served["path"] < 1 {
		t.Fatal("nothing was requested over the path topics")
	}

	// path.point advances in order. Points 1 and 2 are the same place (a segment
	// repeats the last point of the one before), so they are reached together.
	// The blade is on only for the last leg: the first point of a segment is not
	// driven to with the blade.
	var seen []int
	bladeBefore2, bladeLast := false, false
	for i := 0; i < 1500 && r.m.ap.mode == "path"; i++ {
		r.advance(20 * time.Millisecond)
		p := r.m.ap.value("path.point")
		if p == nil {
			if r.m.ap.blade {
				bladeBefore2 = true
			}
			continue
		}
		n := p.(int)
		if total := r.m.ap.value("path.points"); total == nil || total.(int) <= n {
			t.Fatalf("path.points %v with path.point %d", total, n)
		}
		if len(seen) == 0 || seen[len(seen)-1] != n {
			seen = append(seen, n)
		}
		if r.m.ap.blade && n < 2 {
			bladeBefore2 = true
		}
		if r.m.ap.blade && n >= 2 {
			bladeLast = true
		}
	}
	if len(seen) < 2 || seen[0] != 0 || seen[len(seen)-1] < 2 {
		t.Fatalf("path.point sequence %v", seen)
	}
	for i := 1; i < len(seen); i++ {
		if seen[i] <= seen[i-1] {
			t.Fatalf("path.point went back: %v", seen)
		}
	}
	if bladeBefore2 || !bladeLast {
		t.Fatalf("blade on before the blade segment: %v, on in it: %v", bladeBefore2, bladeLast)
	}
	a := r.wantAck("autopilot", "c-j-2031", "done", "")
	if a["result"].(map[string]any)["points"].(float64) != 4 {
		t.Fatalf("result %v", a["result"])
	}
	r.advance(100 * time.Millisecond)
	if s := r.apState(); s["mode"] != "idle" || s["path"] != nil {
		t.Fatalf("after the path: %v", s)
	}
	if r.m.ap.value("path.point") != nil {
		t.Fatal("path.point outside a path is not null")
	}
	if r.m.ap.value("path.points") != nil {
		t.Fatal("path.points outside a path is not null")
	}
	if r.m.ap.blade {
		t.Fatal("blade on after the path")
	}
	approx(t, "end north", r.m.ap.y, 1.5, 0.3)
	approx(t, "end east", r.m.ap.x, 2, 0.3)
}

func TestPathFromPoint(t *testing.T) {
	r := newRig(t).online()
	r.startPath("j-1", r.twoSegmentPath("j-1"), `"from_point":3`)
	r.advance(200 * time.Millisecond)
	if r.m.ap.value("path.point") != nil {
		t.Fatal("path.point before the first point is reached must be null")
	}
	r.advance(15 * time.Second)
	a := r.wantAck("autopilot", "c-j-1", "done", "")
	// The result counts all points of the path, also those skipped.
	if a["result"].(map[string]any)["points"].(float64) != 4 {
		t.Fatalf("result %v", a["result"])
	}
	// It drove to point 3 at once, so it never passed point 0 or 1.
	approx(t, "end", r.m.ap.y, 1.5, 0.3)
}

func TestPathDownloadMultipleChunks(t *testing.T) {
	r := newRig(t).online()
	file := r.bigPath("j-big", 700)
	if len(file) <= 2*chunkSize {
		t.Fatalf("test file is only %d bytes", len(file))
	}
	r.startPath("j-big", file)
	r.advance(2 * time.Second)
	want := (len(file) + chunkSize - 1) / chunkSize
	if r.served["path"] != want {
		t.Fatalf("%d chunk requests for %d chunks", r.served["path"], want)
	}
	r.advance(5 * time.Second)
	a := r.wantAck("autopilot", "c-j-big", "done", "")
	if a["result"].(map[string]any)["points"].(float64) != 700 {
		t.Fatalf("result %v", a["result"])
	}
}

func TestPathDownloadRetriesLostAnswers(t *testing.T) {
	r := newRig(t).online()
	file := r.bigPath("j-retry", 400)
	r.drop["path"] = 2
	r.startPath("j-retry", file)
	r.advance(9 * time.Second)
	if r.served["path"] != 1 {
		t.Fatalf("a request was repeated before the 10 s timeout: %d", r.served["path"])
	}
	r.advance(time.Second + 100*time.Millisecond) // 10 s: asks again
	if r.served["path"] != 2 {
		t.Fatalf("requests after 10 s: %d, want 2", r.served["path"])
	}
	r.advance(10 * time.Second) // 20 s: third request is answered
	r.advance(5 * time.Second)
	r.wantAck("autopilot", "c-j-retry", "done", "")
	// Every retry carried a new request id.
	ids := map[string]bool{}
	for _, id := range r.reqIDs["path"] {
		if ids[id] {
			t.Fatalf("request id %s used twice", id)
		}
		ids[id] = true
	}
}

func TestPathDownloadFailsAfterFiveRetries(t *testing.T) {
	r := newRig(t).online()
	file := r.bigPath("j-dead", 100)
	r.drop["path"] = 100
	r.startPath("j-dead", file)
	r.advance(59 * time.Second) // the fifth retry went out at 50 s
	if a := r.acks("autopilot", "c-j-dead"); len(a) != 1 {
		t.Fatalf("ended early: %v", a)
	}
	r.advance(2 * time.Second)
	r.wantAck("autopilot", "c-j-dead", "failed", "download_failed")
	if r.served["path"] != 6 {
		t.Fatalf("%d requests, want the first and five retries", r.served["path"])
	}
	r.advance(100 * time.Millisecond)
	if r.apState()["mode"] != "idle" {
		t.Fatalf("mode %v after a failed path", r.apState()["mode"])
	}
}

func TestPathBadFiles(t *testing.T) {
	good := func(r *rig) []byte { return r.twoSegmentPath("j-x") }
	for name, tc := range map[string]struct {
		file func(r *rig) []byte
		size int // added to the real size
		sha  string
		code string
	}{
		"size differs":     {good, 1, "", "bad_path"},
		"sha differs":      {good, 0, strings.Repeat("0", 64), "bad_path"},
		"not json":         {func(*rig) []byte { return []byte("nope") }, 0, "", "bad_path"},
		"other path id":    {func(r *rig) []byte { return pathFile("j-other", 0.5, seg{false, [][2]float64{r.geo(1, 0)}}) }, 0, "", "bad_path"},
		"no segments":      {func(*rig) []byte { return pathFile("j-x", 0.5) }, 0, "", "bad_path"},
		"empty segment":    {func(*rig) []byte { return pathFile("j-x", 0.5, seg{false, nil}) }, 0, "", "bad_path"},
		"bad position":     {func(*rig) []byte { return pathFile("j-x", 0.5, seg{false, [][2]float64{{99, 0}}}) }, 0, "", "bad_path"},
		"point not a pair": {func(*rig) []byte { return []byte(`{"path":"j-x","segments":[{"blade":false,"points":[[1]]}]}`) }, 0, "", "bad_path"},
	} {
		t.Run(name, func(t *testing.T) {
			r := newRig(t).online()
			file := tc.file(r)
			r.files["path/j-x.json"] = file
			sha := shaHex(file)
			if tc.sha != "" {
				sha = tc.sha
			}
			r.cmd("autopilot", "c-x", "path_start", `"path":"j-x","size":`+strconv.Itoa(len(file)+tc.size)+`,"sha256":"`+sha+`"`)
			r.advance(time.Second)
			r.wantAck("autopilot", "c-x", "failed", tc.code)
			if r.m.ap.mode != "idle" {
				t.Fatalf("mode %s", r.m.ap.mode)
			}
		})
	}

	r := newRig(t).online()
	r.cmd("autopilot", "c-nf", "path_start", `"path":"j-missing","size":5,"sha256":"`+sha64+`"`)
	r.advance(time.Second)
	r.wantAck("autopilot", "c-nf", "failed", "download_failed") // the server's not_found

	r = newRig(t).online()
	r.startPath("j-x", r.twoSegmentPath("j-x"), `"from_point":9`)
	r.advance(time.Second)
	r.wantAck("autopilot", "c-j-x", "failed", "bad_path")
}

func TestPathStartParameters(t *testing.T) {
	r := newRig(t).online()
	for id, params := range map[string]string{
		"p1": `"size":5,"sha256":"` + sha64 + `"`,
		"p2": `"path":"j","sha256":"` + sha64 + `"`,
		"p3": `"path":"j","size":5`,
		"p4": `"path":"j","size":5,"sha256":"ABC"`,
		"p5": `"path":"j","size":5,"sha256":"` + strings.ToUpper(sha64) + `"`,
		"p6": `"path":"bad id","size":5,"sha256":"` + sha64 + `"`,
		"p7": `"path":"j","size":5,"sha256":"` + sha64 + `","from_point":-1`,
	} {
		r.cmd("autopilot", id, "path_start", params)
		r.wantAck("autopilot", id, "failed", "bad_request")
	}
	if r.m.ap.mode != "idle" {
		t.Fatal("mode changed")
	}
}

func TestPathPauseDuringDownload(t *testing.T) {
	r := newRig(t).online()
	file := r.bigPath("j-p", 1000)
	chunks := (len(file) + chunkSize - 1) / chunkSize
	if chunks < 4 {
		t.Fatalf("only %d chunks", chunks)
	}
	r.startPath("j-p", file) // chunk 0 answered, chunk 1 requested
	r.cmd("autopilot", "pz", "pause")
	r.wantAck("autopilot", "pz", "done", "")
	n := r.served["path"]
	r.advance(15 * time.Second)
	if r.served["path"] > n+1 {
		t.Fatalf("the download went on while paused: %d requests", r.served["path"])
	}
	if r.m.ap.mode != "path" {
		t.Fatal("left path mode")
	}
	r.cmd("autopilot", "rz", "resume")
	r.advance(10 * time.Second)
	r.wantAck("autopilot", "c-j-p", "done", "")
}

func TestPathStopCancels(t *testing.T) {
	r := newRig(t).online()
	r.startPath("j-s", r.twoSegmentPath("j-s"))
	r.advance(time.Second)
	r.cmd("autopilot", "st", "stop")
	r.wantAck("autopilot", "c-j-s", "failed", "cancelled")
	r.advance(100 * time.Millisecond)
	if s := r.apState(); s["mode"] != "idle" || s["path"] != nil {
		t.Fatalf("%v", s)
	}
	// To continue, the server sends path_start again with from_point.
	r.startPath("j-s2", r.twoSegmentPath("j-s2"), `"from_point":2`)
	r.advance(15 * time.Second)
	r.wantAck("autopilot", "c-j-s2", "done", "")
}

func TestPathFaultEndsWithFaultCode(t *testing.T) {
	r := newRig(t).online()
	r.startPath("j-f", r.twoSegmentPath("j-f"))
	r.advance(time.Second)
	_ = r.m.set("fault", "blade_stall")
	r.advance(100 * time.Millisecond)
	r.wantAck("autopilot", "c-j-f", "failed", "blade_stall")
}

// The blade goes off at a pause and comes back, with the segment's state, when
// the path continues (resume after a pause by command or link).
func TestPathBladeBackAfterResume(t *testing.T) {
	r := newRig(t).online()
	file := pathFile("j-b", 0.6, seg{true, [][2]float64{r.geo(0, 0.05), r.geo(0, 40)}})
	r.startPath("j-b", file)
	r.advance(4 * time.Second)
	if !r.m.ap.blade || r.m.ap.mode != "path" {
		t.Fatal("blade not on inside the blade segment")
	}
	r.cmd("autopilot", "pz", "pause")
	if r.m.ap.blade {
		t.Fatal("blade on at the pause")
	}
	r.cmd("autopilot", "rz", "resume")
	r.advance(100 * time.Millisecond)
	if !r.m.ap.blade {
		t.Fatal("blade not back after resume by command")
	}
	r.serverStatus("offline")
	r.advance(11 * time.Second)
	if r.m.ap.paused == nil || r.m.ap.blade {
		t.Fatal("not paused for the link, or blade on")
	}
	r.serverStatus("online")
	r.advance(2 * time.Second)
	r.cmd("autopilot", "rz2", "resume")
	r.advance(100 * time.Millisecond)
	if !r.m.ap.blade {
		t.Fatal("blade not back after resume from a link pause")
	}
}

// The last point reached is published in telemetry before the path ends.
func TestFinalPathPointPublishedBeforePathEnds(t *testing.T) {
	r := newRig(t).online()
	r.startPath("j-2031", r.twoSegmentPath("j-2031"))
	r.advance(20 * time.Second)
	r.wantAck("autopilot", "c-j-2031", "done", "")
	lastPoint, finalAck, idle := -1, -1, -1
	for i, m := range r.out {
		switch m.topic {
		case "autopilot/telemetry":
			var v struct{ Metrics map[string]any }
			_ = json.Unmarshal(m.payload, &v)
			if p, ok := v.Metrics["path.point"].(float64); ok && p == 3 {
				lastPoint = i
			}
		case "autopilot/cmd/ack":
			if bytes.Contains(m.payload, []byte(`"c-j-2031"`)) && bytes.Contains(m.payload, []byte(`"done"`)) {
				finalAck = i
			}
		case "autopilot/state":
			if bytes.Contains(m.payload, []byte(`"mode":"idle"`)) {
				idle = i
			}
		}
	}
	if lastPoint < 0 || finalAck < 0 || lastPoint > finalAck || (idle >= 0 && lastPoint > idle) {
		t.Fatalf("final path.point at %d, final ack at %d, idle state at %d", lastPoint, finalAck, idle)
	}
}
