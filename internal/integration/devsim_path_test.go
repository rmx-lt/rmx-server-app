//go:build integration

// A path stored in the database is downloaded and followed by the simulated
// mower: the real server, the real devsim (built here and run as a process) and
// the broker of the compose stack (wiki Mower-Protocol §11, §12).

package integration

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/transfer"
)

// startDevsim builds devsim and runs it against the app's broker under a new
// device name; it returns the name once the simulated mower's states are in.
func startDevsim(t *testing.T, app *testApp) string {
	bin := filepath.Join(t.TempDir(), "devsim")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	if out, err := exec.Command("go", "build", "-o", bin, "github.com/rmx-lt/rmx-server-app/cmd/devsim").CombinedOutput(); err != nil {
		t.Fatalf("building devsim: %v\n%s", err, out)
	}
	name := "it-" + randomHex(4)
	ctx, stop := context.WithCancel(context.Background())
	sim := exec.CommandContext(ctx, bin, "-name", name, "-state", "-", "-control", "", "-gateway-period", "2s")
	sim.Env = append(os.Environ(), "MQTT_TOPIC_PREFIX="+app.prefix)
	sim.Stdout, sim.Stderr = os.Stderr, os.Stderr
	if err := sim.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { stop(); _ = sim.Wait() })
	app.waitDevice(name, "the simulated mower's state", func(d api.DeviceDetail) bool { return hasState(d.Gateway.State) && hasState(d.Autopilot.State) })
	return name
}

func TestDevsimDownloadsAndFollowsAPathFromTheDatabase(t *testing.T) {
	t.Parallel()
	pool := newDatabase(t)
	app := startApp(t, pool)
	name := startDevsim(t, app)

	// Padding makes the file span three chunks. The first point is where devsim starts.
	const lat, lon = 54.687157, 25.279652
	pts := make([][2]float64, 400, 401)
	for i := range pts {
		pts[i] = [2]float64{lat, lon}
	}
	pts = append(pts, [2]float64{lat, lon + 0.00002})
	doc, _ := json.Marshal(map[string]any{"path": "p-it", "segments": []any{
		map[string]any{"type": "transit", "points": pts},
	}})
	if err := transfer.StorePath(context.Background(), pool, "p-it", doc); err != nil {
		t.Fatal(err)
	}
	// The size and hash the command carries are the table's own.
	var size int
	var sum []byte
	if err := pool.QueryRow(context.Background(), `SELECT size, sha256 FROM paths WHERE id = 'p-it'`).Scan(&size, &sum); err != nil {
		t.Fatal(err)
	}
	if size != len(doc) || size <= 2*transfer.ChunkBytes {
		t.Fatalf("stored size %d, file %d", size, len(doc))
	}

	status, sent, _ := app.sendCommand(name, map[string]any{"board": "autopilot", "cmd": "path_start",
		"params": map[string]any{"path": "p-it", "size": size, "sha256": hex.EncodeToString(sum)}, "expires_in": 60})
	eq(t, status, 202)
	var done api.Command
	for deadline := time.Now().Add(30 * time.Second); ; time.Sleep(100 * time.Millisecond) {
		done = app.command(name, sent.ID)
		if done.State != api.CommandSent && done.State != api.CommandAccepted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("path_start still %s after 30 s", done.State)
		}
	}
	if done.State != api.CommandDone {
		t.Fatalf("path_start: %s (error %v, message %v)", done.State, done.Error, done.Message)
	}
	eq(t, string(done.Result), fmt.Sprintf(`{"points":%d}`, len(pts)))
	t.Logf("path of %d bytes, %d points: downloaded from the paths table in %d chunks, followed, state %s", size, len(pts), transfer.ChunkCount(int64(size)), done.State)
}

// A stored path with all three segment types is followed with the blade on
// only where the type says so; a speed_limit sent during the path changes the
// speed at once and shows in the state (wiki Mower-Protocol §7.1, §8, §11).
func TestDevsimFollowsSegmentTypesAndSpeedLimits(t *testing.T) {
	t.Parallel()
	pool := newDatabase(t)
	app := startApp(t, pool)
	name := startDevsim(t, app)

	// The path runs east and north from where devsim starts (its origin).
	const lat0, lon0 = 54.687157, 25.279652
	at := func(east, north float64) [2]float64 {
		return [2]float64{lat0 + north/111320, lon0 + east/(111320*math.Cos(lat0*math.Pi/180))}
	}
	doc, _ := json.Marshal(map[string]any{"path": "p-types", "segments": []any{
		map[string]any{"type": "transit", "points": [][2]float64{at(0, 0), at(0, 2)}},
		// Short segments: the mower drives at 0.3-0.6 m/s, so every metre is seconds of test.
		map[string]any{"type": "edge", "points": [][2]float64{at(0, 2), at(2, 2)}},
		map[string]any{"type": "fill", "points": [][2]float64{at(2, 2), at(2, 8)}},
	}})
	if err := transfer.StorePath(context.Background(), pool, "p-types", doc); err != nil {
		t.Fatal(err)
	}
	var size int
	var sum []byte
	if err := pool.QueryRow(context.Background(), `SELECT size, sha256 FROM paths WHERE id = 'p-types'`).Scan(&size, &sum); err != nil {
		t.Fatal(err)
	}
	status, sent, _ := app.sendCommand(name, map[string]any{"board": "autopilot", "cmd": "path_start",
		"params": map[string]any{"path": "p-types", "size": size, "sha256": hex.EncodeToString(sum)}, "expires_in": 60})
	eq(t, status, 202)

	latest := func(metric string) float64 {
		for _, l := range app.device(name).Latest {
			if l.Board == api.BoardAutopilot && l.Metric == metric && l.Value != nil {
				return *l.Value
			}
		}
		return math.NaN()
	}
	limit := func(d api.DeviceDetail, key string) float64 {
		var st struct {
			SpeedLimit map[string]float64 `json:"speed_limit"`
		}
		_ = json.Unmarshal(d.Autopilot.State, &st)
		return st.SpeedLimit[key]
	}
	north := func() float64 { return (latest("position.lat") - lat0) * 111320 }

	// In the fill segment, at its full speed: set the limit for fill.
	eventuallyLong(t, "the fill segment at speed", func() bool { return north() > 4 && latest("position.speed") > 0.4 })
	_, _, _ = app.sendCommand(name, map[string]any{"board": "autopilot", "cmd": "speed_limit",
		"params": map[string]any{"limits": map[string]any{"fill": 0.2}}})
	app.waitDevice(name, "the new limit in the state", func(d api.DeviceDetail) bool { return limit(d, "fill") == 0.2 })
	eventuallyLong(t, "the speed at the new limit", func() bool { v := latest("position.speed"); return v > 0.1 && v < 0.25 })
	// Back to the default, so the path ends in time.
	_, _, _ = app.sendCommand(name, map[string]any{"board": "autopilot", "cmd": "speed_limit",
		"params": map[string]any{"limits": map[string]any{"fill": nil}}})
	app.waitDevice(name, "the default limit again", func(d api.DeviceDetail) bool { return limit(d, "fill") == 0.5 })

	var done api.Command
	for deadline := time.Now().Add(60 * time.Second); ; time.Sleep(200 * time.Millisecond) {
		done = app.command(name, sent.ID)
		if done.State != api.CommandSent && done.State != api.CommandAccepted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("path_start still %s after 60 s", done.State)
		}
	}
	if done.State != api.CommandDone {
		t.Fatalf("path_start: %s (error %v, message %v)", done.State, done.Error, done.Message)
	}
	eq(t, string(done.Result), `{"points":6}`)

	// The blade follows the type: samples are one telemetry message each.
	blade := map[time.Time]float64{}
	for _, p := range app.history(name, "autopilot", "blade.on").Points {
		blade[p.Time] = p.Value
	}
	lons := app.history(name, "autopilot", "position.lon").Points
	lats := map[time.Time]float64{}
	for _, p := range app.history(name, "autopilot", "position.lat").Points {
		lats[p.Time] = p.Value
	}
	seen := map[string]bool{}
	for _, p := range lons {
		b, ok := blade[p.Time]
		if !ok {
			continue
		}
		e := (p.Value - lon0) * 111320 * math.Cos(lat0*math.Pi/180)
		n := (lats[p.Time] - lat0) * 111320
		switch {
		case n < 1.7 && e < 0.3: // inside the transit segment
			seen["transit"] = true
			eq(t, b, 0.0)
		case n > 1.7 && n < 2.3 && e > 0.6 && e < 1.5: // inside the edge segment
			seen["edge"] = true
			eq(t, b, 1.0)
		case e > 1.7 && n > 2.8: // inside the fill segment
			seen["fill"] = true
			eq(t, b, 1.0)
		}
	}
	if !seen["transit"] || !seen["edge"] || !seen["fill"] {
		t.Fatalf("telemetry did not cover every segment: %v", seen)
	}
}

// eventuallyLong is eventually for things that need the mower to drive.
func eventuallyLong(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("not in time: %s", what)
		}
		time.Sleep(100 * time.Millisecond)
	}
}
