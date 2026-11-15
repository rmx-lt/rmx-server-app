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
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/rmx-lt/rmx-server-app/internal/api"
	"github.com/rmx-lt/rmx-server-app/internal/transfer"
)

func TestDevsimDownloadsAndFollowsAPathFromTheDatabase(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "devsim")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	if out, err := exec.Command("go", "build", "-o", bin, "github.com/rmx-lt/rmx-server-app/cmd/devsim").CombinedOutput(); err != nil {
		t.Fatalf("building devsim: %v\n%s", err, out)
	}

	pool := newDatabase(t)
	app := startApp(t, pool)
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

	// Padding makes the file span three chunks. The first point is where devsim starts.
	const lat, lon = 54.687157, 25.279652
	pts := make([][2]float64, 400, 401)
	for i := range pts {
		pts[i] = [2]float64{lat, lon}
	}
	pts = append(pts, [2]float64{lat, lon + 0.00002})
	doc, _ := json.Marshal(map[string]any{"path": "p-it", "speed": 0.6, "segments": []any{
		map[string]any{"blade": false, "points": pts},
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
